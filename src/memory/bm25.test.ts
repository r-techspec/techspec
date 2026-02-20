import { describe, it, expect, beforeEach } from 'vitest';
import { BM25Index } from './bm25.js';

describe('BM25Index', () => {
  let index: BM25Index;

  beforeEach(() => {
    index = new BM25Index();
  });

  describe('tokenize', () => {
    it('should lowercase and split text', () => {
      const tokens = index.tokenize('Hello World');
      expect(tokens).toEqual(['hello', 'world']);
    });

    it('should filter short tokens', () => {
      const tokens = index.tokenize('I am a test');
      expect(tokens).not.toContain('i');
      expect(tokens).not.toContain('a');
      expect(tokens).toContain('am');
      expect(tokens).toContain('test');
    });

    it('should split on non-alphanumeric characters', () => {
      const tokens = index.tokenize('hello-world_test.example');
      expect(tokens).toEqual(['hello', 'world', 'test', 'example']);
    });
  });

  describe('addDocument', () => {
    it('should add document to index', () => {
      index.addDocument('doc1', '/path/doc1.md', 'test content', Date.now());
      expect(index.size).toBe(1);
    });

    it('should update existing document', () => {
      index.addDocument('doc1', '/path/doc1.md', 'original', Date.now());
      index.addDocument('doc1', '/path/doc1.md', 'updated', Date.now());
      expect(index.size).toBe(1);
    });
  });

  describe('removeDocument', () => {
    it('should remove document from index', () => {
      index.addDocument('doc1', '/path/doc1.md', 'test', Date.now());
      const removed = index.removeDocument('doc1');
      expect(removed).toBe(true);
      expect(index.size).toBe(0);
    });

    it('should return false for non-existent document', () => {
      const removed = index.removeDocument('nonexistent');
      expect(removed).toBe(false);
    });
  });

  describe('search', () => {
    beforeEach(() => {
      index.addDocument('ts', '/ts.md', 'TypeScript is a typed superset of JavaScript', Date.now());
      index.addDocument('py', '/py.md', 'Python is a dynamic programming language', Date.now());
      index.addDocument('js', '/js.md', 'JavaScript is a scripting language for the web', Date.now());
    });

    it('should return matching documents', () => {
      const results = index.search('typescript');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]?.doc.id).toBe('ts');
    });

    it('should rank by relevance', () => {
      const results = index.search('javascript');
      expect(results.length).toBe(2); // ts and js both mention javascript
      
      // Scores should be in descending order
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1]!.score).toBeGreaterThanOrEqual(results[i]!.score);
      }
    });

    it('should return empty for no matches', () => {
      const results = index.search('rust golang');
      expect(results).toEqual([]);
    });

    it('should respect limit', () => {
      const results = index.search('language', 1);
      expect(results.length).toBe(1);
    });

    it('should handle multi-word queries', () => {
      const results = index.search('programming language');
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe('getAllDocuments', () => {
    it('should return all indexed documents', () => {
      index.addDocument('doc1', '/doc1.md', 'content 1', Date.now());
      index.addDocument('doc2', '/doc2.md', 'content 2', Date.now());
      
      const docs = index.getAllDocuments();
      expect(docs.length).toBe(2);
    });
  });

  describe('clear', () => {
    it('should clear all documents', () => {
      index.addDocument('doc1', '/doc1.md', 'content', Date.now());
      index.clear();
      expect(index.size).toBe(0);
    });
  });
});
