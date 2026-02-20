import { readFile, readdir, stat, writeFile, access, constants } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { Workspace } from '../storage/workspace.js';
import { Logger } from '../logging/logger.js';
import { BM25Index, type IndexedDocument } from './bm25.js';
import type { TranscriptEntry, Session } from '../session/session-manager.js';

/**
 * Memory system configuration
 */
export interface MemoryConfig {
  workspacePath: string;
  maxContextTokens: number;
  temporalDecayHalfLife: number; // days
}

/**
 * Default memory configuration
 */
export const DEFAULT_MEMORY_CONFIG: MemoryConfig = {
  workspacePath: '~/.openclaw/workspace',
  maxContextTokens: 100000,
  temporalDecayHalfLife: 7,
};

/**
 * Search result from memory system
 */
export interface SearchResult {
  path: string;
  content: string;
  score: number;
  timestamp: number;
}

/**
 * Document representation
 */
export interface Document {
  path: string;
  content: string;
  timestamp: number;
}

/**
 * MemorySystem - Manages context retrieval and memory for the AI assistant
 * 
 * Requirements:
 * - 5.1: Load bootstrap files (SOUL.md, USER.md) into prompt context
 * - 5.2: Search for relevant context using hybrid BM25 search
 * - 5.3: Summarize older messages when context exceeds limit
 * - 5.4: Apply temporal decay to search results
 * - 5.5: Use MMR re-ranking to diversify retrieved context
 */
export class MemorySystem {
  private workspace: Workspace;
  private logger: Logger;
  private config: MemoryConfig;
  private bm25Index: BM25Index;
  private bootstrapCache: { soul: string; user: string } | null = null;

  constructor(workspace: Workspace, config: Partial<MemoryConfig> = {}, logger?: Logger) {
    this.workspace = workspace;
    this.config = { ...DEFAULT_MEMORY_CONFIG, ...config };
    this.logger = logger ?? new Logger({ level: 'info', path: 'openclaw.log', maxSize: 10485760, maxFiles: 5 });
    this.bm25Index = new BM25Index();
  }

  /**
   * Loads bootstrap files (SOUL.md and USER.md) into prompt context
   * Requirement 5.1: Load bootstrap files into prompt context
   */
  async loadBootstrap(): Promise<string> {
    let soulContent = '';
    let userContent = '';

    // Load SOUL.md
    try {
      await access(this.workspace.soulPath, constants.F_OK);
      soulContent = await readFile(this.workspace.soulPath, 'utf-8');
    } catch {
      await this.logger.debug('SOUL.md not found, using empty content');
    }

    // Load USER.md
    try {
      await access(this.workspace.userPath, constants.F_OK);
      userContent = await readFile(this.workspace.userPath, 'utf-8');
    } catch {
      await this.logger.debug('USER.md not found, using empty content');
    }

    // Cache for later use
    this.bootstrapCache = { soul: soulContent, user: userContent };

    // Combine bootstrap content
    const parts: string[] = [];
    if (soulContent.trim()) {
      parts.push(soulContent.trim());
    }
    if (userContent.trim()) {
      parts.push(userContent.trim());
    }

    return parts.join('\n\n');
  }


  /**
   * Gets the cached bootstrap content
   */
  getBootstrapCache(): { soul: string; user: string } | null {
    return this.bootstrapCache;
  }

  /**
   * Indexes all markdown files in the workspace memory directory
   * Requirement 5.2: Index workspace markdown files
   */
  async indexWorkspace(): Promise<number> {
    const memoryDir = this.workspace.memoryDir;
    let indexedCount = 0;

    try {
      await access(memoryDir, constants.F_OK);
    } catch {
      await this.logger.debug('Memory directory does not exist');
      return 0;
    }

    const files = await this.walkDirectory(memoryDir, '.md');
    
    for (const filePath of files) {
      try {
        const content = await readFile(filePath, 'utf-8');
        const stats = await stat(filePath);
        const relativePath = relative(this.workspace.root, filePath);
        
        this.bm25Index.addDocument(
          relativePath,
          relativePath,
          content,
          stats.mtimeMs
        );
        indexedCount++;
      } catch (error) {
        await this.logger.warn('Failed to index file', { path: filePath, error: String(error) });
      }
    }

    await this.logger.debug('Indexed workspace files', { count: indexedCount });
    return indexedCount;
  }

  /**
   * Recursively walks a directory and returns files matching the extension
   */
  private async walkDirectory(dir: string, extension: string): Promise<string[]> {
    const files: string[] = [];
    
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        
        if (entry.isDirectory()) {
          const subFiles = await this.walkDirectory(fullPath, extension);
          files.push(...subFiles);
        } else if (entry.isFile() && entry.name.endsWith(extension)) {
          files.push(fullPath);
        }
      }
    } catch {
      // Directory doesn't exist or can't be read
    }
    
    return files;
  }

  /**
   * Adds a document to the memory index
   */
  async addDocument(path: string, content: string): Promise<void> {
    const fullPath = this.workspace.resolve(path);
    const stats = await stat(fullPath).catch(() => ({ mtimeMs: Date.now() }));
    
    this.bm25Index.addDocument(path, path, content, stats.mtimeMs);
    await this.logger.debug('Added document to index', { path });
  }

  /**
   * Searches for relevant context using BM25 with temporal decay
   * Requirements: 5.2, 5.4
   */
  search(query: string, limit: number = 10): SearchResult[] {
    // Get BM25 results
    const bm25Results = this.bm25Index.search(query, limit * 2); // Get more for re-ranking
    
    if (bm25Results.length === 0) {
      return [];
    }

    // Apply temporal decay
    const now = Date.now();
    const halfLifeMs = this.config.temporalDecayHalfLife * 24 * 60 * 60 * 1000;
    
    const decayedResults = bm25Results.map(({ doc, score }) => {
      const ageMs = now - doc.timestamp;
      const decayFactor = Math.pow(0.5, ageMs / halfLifeMs);
      return {
        path: doc.path,
        content: doc.content,
        score: score * decayFactor,
        timestamp: doc.timestamp,
      };
    });

    // Sort by decayed score
    decayedResults.sort((a, b) => b.score - a.score);

    // Apply MMR re-ranking for diversity
    const diverseResults = this.mmrRerank(decayedResults, limit);

    return diverseResults;
  }

  /**
   * Applies temporal decay to a score based on document age
   * Requirement 5.4: Apply temporal decay to search results
   */
  applyTemporalDecay(score: number, timestamp: number): number {
    const now = Date.now();
    const halfLifeMs = this.config.temporalDecayHalfLife * 24 * 60 * 60 * 1000;
    const ageMs = now - timestamp;
    const decayFactor = Math.pow(0.5, ageMs / halfLifeMs);
    return score * decayFactor;
  }


  /**
   * Calculates Jaccard similarity between two texts
   * Used for MMR diversity calculation
   */
  private jaccardSimilarity(text1: string, text2: string): number {
    const tokens1 = new Set(text1.toLowerCase().split(/\s+/));
    const tokens2 = new Set(text2.toLowerCase().split(/\s+/));
    
    const intersection = new Set([...tokens1].filter(x => tokens2.has(x)));
    const union = new Set([...tokens1, ...tokens2]);
    
    if (union.size === 0) return 0;
    return intersection.size / union.size;
  }

  /**
   * Applies MMR (Maximal Marginal Relevance) re-ranking for diversity
   * Requirement 5.5: Use MMR re-ranking to diversify retrieved context
   * 
   * MMR balances relevance with diversity by penalizing documents
   * that are too similar to already selected documents.
   */
  mmrRerank(results: SearchResult[], limit: number, lambda: number = 0.7): SearchResult[] {
    if (results.length <= 1) {
      return results.slice(0, limit);
    }

    const selected: SearchResult[] = [];
    const remaining = [...results];

    // Select first document (highest score)
    const first = remaining.shift();
    if (first) {
      selected.push(first);
    }

    // Iteratively select documents that maximize MMR
    while (selected.length < limit && remaining.length > 0) {
      let bestIdx = 0;
      let bestMmrScore = -Infinity;

      for (let i = 0; i < remaining.length; i++) {
        const candidate = remaining[i];
        if (!candidate) continue;

        // Calculate max similarity to already selected documents
        let maxSimilarity = 0;
        for (const sel of selected) {
          const sim = this.jaccardSimilarity(candidate.content, sel.content);
          maxSimilarity = Math.max(maxSimilarity, sim);
        }

        // MMR score: lambda * relevance - (1 - lambda) * max_similarity
        const mmrScore = lambda * candidate.score - (1 - lambda) * maxSimilarity;

        if (mmrScore > bestMmrScore) {
          bestMmrScore = mmrScore;
          bestIdx = i;
        }
      }

      const best = remaining.splice(bestIdx, 1)[0];
      if (best) {
        selected.push(best);
      }
    }

    return selected;
  }

  /**
   * Estimates token count for text (rough approximation: ~4 chars per token)
   */
  estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * Compacts context when it exceeds the maximum token limit
   * Requirement 5.3: Summarize older messages when context exceeds limit
   */
  async compact(
    history: TranscriptEntry[],
    maxTokens?: number
  ): Promise<{ compactedHistory: TranscriptEntry[]; flushedFacts: string[] }> {
    const limit = maxTokens ?? this.config.maxContextTokens;
    
    // Calculate current token usage
    let totalTokens = 0;
    for (const entry of history) {
      totalTokens += this.estimateTokens(entry.content);
    }

    // If within limit, no compaction needed
    if (totalTokens <= limit) {
      return { compactedHistory: history, flushedFacts: [] };
    }

    await this.logger.info('Compacting context', { 
      currentTokens: totalTokens, 
      limit,
      messageCount: history.length 
    });

    // Strategy: Keep recent messages, summarize older ones
    const compactedHistory: TranscriptEntry[] = [];
    const flushedFacts: string[] = [];
    
    // Keep the most recent messages that fit within 70% of limit
    const recentLimit = Math.floor(limit * 0.7);
    let recentTokens = 0;
    const recentMessages: TranscriptEntry[] = [];
    
    // Work backwards from most recent
    for (let i = history.length - 1; i >= 0; i--) {
      const entry = history[i];
      if (!entry) continue;
      
      const entryTokens = this.estimateTokens(entry.content);
      if (recentTokens + entryTokens <= recentLimit) {
        recentMessages.unshift(entry);
        recentTokens += entryTokens;
      } else {
        break;
      }
    }

    // Extract important facts from older messages
    const olderMessages = history.slice(0, history.length - recentMessages.length);
    const facts = this.extractFacts(olderMessages);
    
    // Create a summary entry if there are older messages
    if (olderMessages.length > 0 && facts.length > 0) {
      const summaryContent = `[Context Summary: ${facts.join('; ')}]`;
      const summaryEntry: TranscriptEntry = {
        id: 'summary-' + Date.now(),
        role: 'assistant',
        content: summaryContent,
        timestamp: olderMessages[0]?.timestamp ?? Date.now(),
      };
      compactedHistory.push(summaryEntry);
      flushedFacts.push(...facts);
    }

    // Add recent messages
    compactedHistory.push(...recentMessages);

    // Flush facts to disk
    if (flushedFacts.length > 0) {
      await this.flushFactsToDisk(flushedFacts);
    }

    await this.logger.info('Context compacted', {
      originalMessages: history.length,
      compactedMessages: compactedHistory.length,
      flushedFacts: flushedFacts.length,
    });

    return { compactedHistory, flushedFacts };
  }


  /**
   * Extracts important facts from transcript entries
   * Simple heuristic: look for statements, definitions, preferences
   */
  private extractFacts(entries: TranscriptEntry[]): string[] {
    const facts: string[] = [];
    
    for (const entry of entries) {
      // Skip tool entries
      if (entry.role === 'tool') continue;
      
      // Extract sentences that look like facts
      const sentences = entry.content.split(/[.!?]+/).filter(s => s.trim().length > 10);
      
      for (const sentence of sentences) {
        const trimmed = sentence.trim();
        
        // Heuristics for fact-like sentences
        const isDefinition = /\b(is|are|was|were|means|refers to)\b/i.test(trimmed);
        const isPreference = /\b(prefer|like|want|need|should|must)\b/i.test(trimmed);
        const isStatement = /\b(always|never|usually|typically|important)\b/i.test(trimmed);
        
        if (isDefinition || isPreference || isStatement) {
          // Limit fact length
          const fact = trimmed.length > 100 ? trimmed.slice(0, 100) + '...' : trimmed;
          facts.push(fact);
          
          // Limit total facts
          if (facts.length >= 10) break;
        }
      }
      
      if (facts.length >= 10) break;
    }
    
    return facts;
  }

  /**
   * Flushes extracted facts to disk for future retrieval
   * Requirement 5.3: Flush important facts to disk
   */
  private async flushFactsToDisk(facts: string[]): Promise<void> {
    if (facts.length === 0) return;

    const timestamp = Date.now();
    const filename = `facts-${timestamp}.md`;
    const filePath = join(this.workspace.memoryDir, filename);
    
    const content = [
      `# Extracted Facts`,
      ``,
      `Extracted at: ${new Date(timestamp).toISOString()}`,
      ``,
      ...facts.map(f => `- ${f}`),
    ].join('\n');

    try {
      await writeFile(filePath, content, { mode: 0o600 });
      
      // Add to index
      this.bm25Index.addDocument(
        relative(this.workspace.root, filePath),
        relative(this.workspace.root, filePath),
        content,
        timestamp
      );
      
      await this.logger.debug('Flushed facts to disk', { path: filePath, count: facts.length });
    } catch (error) {
      await this.logger.error('Failed to flush facts to disk', error, { path: filePath });
    }
  }

  /**
   * Gets the BM25 index for testing/inspection
   */
  getIndex(): BM25Index {
    return this.bm25Index;
  }

  /**
   * Gets the current configuration
   */
  getConfig(): MemoryConfig {
    return { ...this.config };
  }

  /**
   * Clears the memory index
   */
  clear(): void {
    this.bm25Index.clear();
    this.bootstrapCache = null;
  }
}
