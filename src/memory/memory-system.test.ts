import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { MemorySystem } from './memory-system.js';
import { Workspace } from '../storage/workspace.js';
import type { TranscriptEntry } from '../session/session-manager.js';

describe('MemorySystem', () => {
  let testDir: string;
  let workspace: Workspace;
  let memorySystem: MemorySystem;

  beforeEach(async () => {
    testDir = join(tmpdir(), `openclaw-test-${randomUUID()}`);
    workspace = new Workspace(testDir);
    await workspace.initialize();
    memorySystem = new MemorySystem(workspace, { temporalDecayHalfLife: 7 });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe('loadBootstrap', () => {
    it('should return empty string when no bootstrap files exist', async () => {
      const result = await memorySystem.loadBootstrap();
      expect(result).toBe('');
    });

    it('should load SOUL.md content', async () => {
      const soulContent = '# Identity\nYou are OpenClaw';
      await writeFile(workspace.soulPath, soulContent);

      const result = await memorySystem.loadBootstrap();
      expect(result).toBe(soulContent);
    });

    it('should load USER.md content', async () => {
      const userContent = '# User Profile\nName: Test User';
      await writeFile(workspace.userPath, userContent);

      const result = await memorySystem.loadBootstrap();
      expect(result).toBe(userContent);
    });

    it('should combine SOUL.md and USER.md content', async () => {
      const soulContent = '# Identity\nYou are OpenClaw';
      const userContent = '# User Profile\nName: Test User';
      await writeFile(workspace.soulPath, soulContent);
      await writeFile(workspace.userPath, userContent);

      const result = await memorySystem.loadBootstrap();
      expect(result).toContain(soulContent);
      expect(result).toContain(userContent);
    });

    it('should cache bootstrap content', async () => {
      const soulContent = '# Identity\nYou are OpenClaw';
      await writeFile(workspace.soulPath, soulContent);

      await memorySystem.loadBootstrap();
      const cache = memorySystem.getBootstrapCache();
      
      expect(cache).not.toBeNull();
      expect(cache?.soul).toBe(soulContent);
    });
  });

  describe('indexWorkspace', () => {
    it('should return 0 when memory directory is empty', async () => {
      const count = await memorySystem.indexWorkspace();
      expect(count).toBe(0);
    });

    it('should index markdown files in memory directory', async () => {
      await writeFile(join(workspace.memoryDir, 'test.md'), '# Test Document\nSome content');
      
      const count = await memorySystem.indexWorkspace();
      expect(count).toBe(1);
    });

    it('should index nested markdown files', async () => {
      const subDir = join(workspace.memoryDir, 'subdir');
      await mkdir(subDir, { recursive: true });
      await writeFile(join(workspace.memoryDir, 'test1.md'), 'Content 1');
      await writeFile(join(subDir, 'test2.md'), 'Content 2');
      
      const count = await memorySystem.indexWorkspace();
      expect(count).toBe(2);
    });
  });

  describe('search', () => {
    beforeEach(async () => {
      // Add test documents
      await writeFile(join(workspace.memoryDir, 'typescript.md'), 
        '# TypeScript Guide\nTypeScript is a typed superset of JavaScript');
      await writeFile(join(workspace.memoryDir, 'python.md'), 
        '# Python Guide\nPython is a dynamic programming language');
      await memorySystem.indexWorkspace();
    });

    it('should return relevant results for query', () => {
      const results = memorySystem.search('typescript');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]?.content).toContain('TypeScript');
    });

    it('should return results ordered by score', () => {
      const results = memorySystem.search('programming language');
      expect(results.length).toBeGreaterThan(0);
      
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1]!.score).toBeGreaterThanOrEqual(results[i]!.score);
      }
    });

    it('should return empty array for no matches', () => {
      const results = memorySystem.search('nonexistent xyz123');
      expect(results).toEqual([]);
    });

    it('should respect limit parameter', () => {
      const results = memorySystem.search('guide', 1);
      expect(results.length).toBeLessThanOrEqual(1);
    });
  });

  describe('temporal decay', () => {
    it('should apply decay based on document age', () => {
      const now = Date.now();
      const score = 1.0;
      
      // Recent document
      const recentScore = memorySystem.applyTemporalDecay(score, now);
      
      // Old document (14 days = 2 half-lives)
      const oldTimestamp = now - 14 * 24 * 60 * 60 * 1000;
      const oldScore = memorySystem.applyTemporalDecay(score, oldTimestamp);
      
      expect(recentScore).toBeGreaterThan(oldScore);
      expect(oldScore).toBeCloseTo(0.25, 1); // 2 half-lives = 0.25
    });
  });

  describe('MMR re-ranking', () => {
    it('should diversify results', () => {
      const results = [
        { path: 'a.md', content: 'typescript javascript programming', score: 1.0, timestamp: Date.now() },
        { path: 'b.md', content: 'typescript javascript programming', score: 0.9, timestamp: Date.now() },
        { path: 'c.md', content: 'python machine learning', score: 0.8, timestamp: Date.now() },
      ];

      const reranked = memorySystem.mmrRerank(results, 2);
      
      // Should prefer diversity - include both typescript and python docs
      expect(reranked.length).toBe(2);
      const contents = reranked.map(r => r.content);
      expect(contents.some(c => c.includes('typescript'))).toBe(true);
      expect(contents.some(c => c.includes('python'))).toBe(true);
    });

    it('should handle single result', () => {
      const results = [
        { path: 'a.md', content: 'test', score: 1.0, timestamp: Date.now() },
      ];

      const reranked = memorySystem.mmrRerank(results, 5);
      expect(reranked).toEqual(results);
    });

    it('should handle empty results', () => {
      const reranked = memorySystem.mmrRerank([], 5);
      expect(reranked).toEqual([]);
    });
  });

  describe('compact', () => {
    it('should not compact when within limit', async () => {
      const history: TranscriptEntry[] = [
        { id: '1', role: 'user', content: 'Hello', timestamp: Date.now() },
        { id: '2', role: 'assistant', content: 'Hi there', timestamp: Date.now() },
      ];

      const { compactedHistory, flushedFacts } = await memorySystem.compact(history, 10000);
      
      expect(compactedHistory).toEqual(history);
      expect(flushedFacts).toEqual([]);
    });

    it('should compact when exceeding limit', async () => {
      const longContent = 'This is important information. '.repeat(100);
      const history: TranscriptEntry[] = [
        { id: '1', role: 'user', content: longContent, timestamp: Date.now() - 10000 },
        { id: '2', role: 'assistant', content: longContent, timestamp: Date.now() - 5000 },
        { id: '3', role: 'user', content: 'Recent message', timestamp: Date.now() },
      ];

      const { compactedHistory } = await memorySystem.compact(history, 100);
      
      // Should have fewer messages after compaction
      expect(compactedHistory.length).toBeLessThanOrEqual(history.length);
    });

    it('should preserve recent messages', async () => {
      const longContent = 'Old content that is important. '.repeat(50);
      const recentContent = 'Recent message';
      const history: TranscriptEntry[] = [
        { id: '1', role: 'user', content: longContent, timestamp: Date.now() - 10000 },
        { id: '2', role: 'user', content: recentContent, timestamp: Date.now() },
      ];

      const { compactedHistory } = await memorySystem.compact(history, 200);
      
      // Recent message should be preserved
      const hasRecent = compactedHistory.some(e => e.content === recentContent);
      expect(hasRecent).toBe(true);
    });
  });

  describe('estimateTokens', () => {
    it('should estimate tokens based on character count', () => {
      const text = 'Hello world'; // 11 chars
      const tokens = memorySystem.estimateTokens(text);
      expect(tokens).toBe(3); // ceil(11/4)
    });
  });
});
