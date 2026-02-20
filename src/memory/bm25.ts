/**
 * BM25 (Best Matching 25) implementation for keyword search
 * 
 * BM25 is a ranking function used by search engines to rank documents
 * based on query terms appearing in each document.
 * 
 * Requirement 5.2: Search for relevant context using BM25 keyword search
 */

/**
 * Document representation for indexing
 */
export interface IndexedDocument {
  id: string;
  path: string;
  content: string;
  timestamp: number;
  terms: Map<string, number>; // term -> frequency
  length: number; // number of terms
}

/**
 * BM25 parameters
 */
export interface BM25Config {
  k1: number; // term frequency saturation parameter (default: 1.2)
  b: number;  // length normalization parameter (default: 0.75)
}

const DEFAULT_BM25_CONFIG: BM25Config = {
  k1: 1.2,
  b: 0.75,
};

/**
 * BM25Index - Implements BM25 ranking algorithm for document search
 * 
 * Requirement 5.2: Search with BM25 scoring
 */
export class BM25Index {
  private documents: Map<string, IndexedDocument> = new Map();
  private documentFrequency: Map<string, number> = new Map(); // term -> number of docs containing term
  private avgDocLength: number = 0;
  private config: BM25Config;

  constructor(config: Partial<BM25Config> = {}) {
    this.config = { ...DEFAULT_BM25_CONFIG, ...config };
  }

  /**
   * Tokenizes text into terms
   * Simple tokenization: lowercase, split on non-alphanumeric, filter short terms
   */
  tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(term => term.length > 1);
  }

  /**
   * Adds a document to the index
   */
  addDocument(id: string, path: string, content: string, timestamp: number): void {
    const terms = this.tokenize(content);
    const termFrequency = new Map<string, number>();

    // Count term frequencies
    for (const term of terms) {
      termFrequency.set(term, (termFrequency.get(term) ?? 0) + 1);
    }

    // Update document frequency for new terms
    const existingDoc = this.documents.get(id);
    if (existingDoc) {
      // Remove old document's contribution to document frequency
      for (const term of existingDoc.terms.keys()) {
        const df = this.documentFrequency.get(term) ?? 0;
        if (df > 1) {
          this.documentFrequency.set(term, df - 1);
        } else {
          this.documentFrequency.delete(term);
        }
      }
    }

    // Add new document's contribution to document frequency
    for (const term of termFrequency.keys()) {
      this.documentFrequency.set(term, (this.documentFrequency.get(term) ?? 0) + 1);
    }

    // Store document
    this.documents.set(id, {
      id,
      path,
      content,
      timestamp,
      terms: termFrequency,
      length: terms.length,
    });

    // Update average document length
    this.updateAvgDocLength();
  }

  /**
   * Removes a document from the index
   */
  removeDocument(id: string): boolean {
    const doc = this.documents.get(id);
    if (!doc) return false;

    // Update document frequency
    for (const term of doc.terms.keys()) {
      const df = this.documentFrequency.get(term) ?? 0;
      if (df > 1) {
        this.documentFrequency.set(term, df - 1);
      } else {
        this.documentFrequency.delete(term);
      }
    }

    this.documents.delete(id);
    this.updateAvgDocLength();
    return true;
  }

  /**
   * Updates the average document length
   */
  private updateAvgDocLength(): void {
    if (this.documents.size === 0) {
      this.avgDocLength = 0;
      return;
    }

    let totalLength = 0;
    for (const doc of this.documents.values()) {
      totalLength += doc.length;
    }
    this.avgDocLength = totalLength / this.documents.size;
  }

  /**
   * Calculates IDF (Inverse Document Frequency) for a term
   */
  private idf(term: string): number {
    const N = this.documents.size;
    const df = this.documentFrequency.get(term) ?? 0;
    
    if (df === 0 || N === 0) return 0;
    
    // Standard BM25 IDF formula
    return Math.log((N - df + 0.5) / (df + 0.5) + 1);
  }

  /**
   * Calculates BM25 score for a document given query terms
   */
  private score(doc: IndexedDocument, queryTerms: string[]): number {
    const { k1, b } = this.config;
    let score = 0;

    for (const term of queryTerms) {
      const tf = doc.terms.get(term) ?? 0;
      if (tf === 0) continue;

      const idf = this.idf(term);
      const lengthNorm = 1 - b + b * (doc.length / (this.avgDocLength || 1));
      const tfNorm = (tf * (k1 + 1)) / (tf + k1 * lengthNorm);

      score += idf * tfNorm;
    }

    return score;
  }

  /**
   * Searches the index and returns documents ranked by BM25 score
   * Requirement 5.2: Search with BM25 scoring
   */
  search(query: string, limit: number = 10): Array<{ doc: IndexedDocument; score: number }> {
    const queryTerms = this.tokenize(query);
    if (queryTerms.length === 0) return [];

    const results: Array<{ doc: IndexedDocument; score: number }> = [];

    for (const doc of this.documents.values()) {
      const docScore = this.score(doc, queryTerms);
      if (docScore > 0) {
        results.push({ doc, score: docScore });
      }
    }

    // Sort by score descending
    results.sort((a, b) => b.score - a.score);

    return results.slice(0, limit);
  }

  /**
   * Gets the number of indexed documents
   */
  get size(): number {
    return this.documents.size;
  }

  /**
   * Gets all indexed documents
   */
  getAllDocuments(): IndexedDocument[] {
    return Array.from(this.documents.values());
  }

  /**
   * Clears the index
   */
  clear(): void {
    this.documents.clear();
    this.documentFrequency.clear();
    this.avgDocLength = 0;
  }
}
