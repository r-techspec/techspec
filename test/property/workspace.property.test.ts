import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import { Workspace } from '../../src/storage/workspace.js';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

/**
 * Property-based tests for Workspace
 * Feature: openclaw-mvp, Property 5: Workspace Path Containment
 * Validates: Requirements 4.1
 */
describe('Workspace Property Tests', () => {
  let testDir: string;
  let workspace: Workspace;

  beforeEach(() => {
    testDir = join(tmpdir(), `openclaw-pbt-${randomUUID()}`);
    workspace = new Workspace(testDir);
  });

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  /**
   * Property 5: Workspace Path Containment
   * For any file created by the system, the file path SHALL be under the configured workspace directory.
   * 
   * We test this by verifying that:
   * 1. Any path resolved via workspace.resolve() is contained within the workspace
   * 2. The contains() method correctly identifies paths inside vs outside the workspace
   */
  describe('Property 5: Workspace Path Containment', () => {
    // Arbitrary for valid relative path segments (no path traversal)
    const validPathSegment = fc.stringMatching(/^[a-zA-Z0-9_-]+$/);
    
    // Arbitrary for valid relative paths within workspace
    const validRelativePath = fc.array(validPathSegment, { minLength: 1, maxLength: 5 })
      .map(segments => segments.join('/'));

    it('resolved paths are always contained within workspace', () => {
      fc.assert(
        fc.property(validRelativePath, (relativePath) => {
          const resolved = workspace.resolve(relativePath);
          return workspace.contains(resolved);
        }),
        { numRuns: 100 }
      );
    });

    it('paths with parent directory traversal are rejected', () => {
      // Generate paths that attempt to escape via ..
      const escapingPath = fc.tuple(
        fc.array(fc.constant('..'), { minLength: 1, maxLength: 10 }),
        validPathSegment
      ).map(([dots, segment]) => [...dots, segment].join('/'));

      fc.assert(
        fc.property(escapingPath, (path) => {
          try {
            workspace.resolve(path);
            return false; // Should have thrown
          } catch (e) {
            return (e as Error).message.includes('outside workspace boundary');
          }
        }),
        { numRuns: 100 }
      );
    });

    it('absolute paths outside workspace are not contained', () => {
      // Generate absolute paths that are clearly outside the workspace
      const outsidePath = fc.tuple(
        fc.constantFrom('/tmp', '/var', '/etc', '/usr'),
        validPathSegment
      ).map(([base, segment]) => join(base, segment));

      fc.assert(
        fc.property(outsidePath, (absolutePath) => {
          // These paths should not be contained in our test workspace
          // (unless by extreme coincidence the test workspace is under one of these)
          if (absolutePath.startsWith(testDir)) {
            return true; // Skip if coincidentally inside
          }
          return !workspace.contains(absolutePath);
        }),
        { numRuns: 100 }
      );
    });

    it('all standard workspace paths are contained', () => {
      // All the standard path helpers should return contained paths
      const standardPaths = [
        workspace.configPath,
        workspace.authPath,
        workspace.sessionsDir,
        workspace.workspaceDir,
        workspace.memoryDir,
        workspace.logsDir,
        workspace.soulPath,
        workspace.userPath,
      ];

      for (const path of standardPaths) {
        expect(workspace.contains(path)).toBe(true);
      }
    });

    it('session paths are always contained for valid session IDs', () => {
      // Valid session IDs (no path separators or traversal)
      const validSessionId = fc.stringMatching(/^[a-zA-Z0-9_-]+$/);

      fc.assert(
        fc.property(validSessionId, (sessionId) => {
          if (sessionId.length === 0) return true; // Skip empty
          const sessionPath = workspace.sessionPath(sessionId);
          return workspace.contains(sessionPath);
        }),
        { numRuns: 100 }
      );
    });

    it('log paths are always contained for valid filenames', () => {
      // Valid log filenames: alphanumeric with underscores, hyphens, and single dots
      // Must not be ".." or start/end with dots in a way that could be traversal
      const validFilename = fc.tuple(
        fc.stringMatching(/^[a-zA-Z0-9_-]+$/),
        fc.constantFrom('.log', '.txt', '')
      ).map(([base, ext]) => base + ext)
        .filter(f => f.length > 0 && !f.includes('..'));

      fc.assert(
        fc.property(validFilename, (filename) => {
          const logPath = workspace.logPath(filename);
          return workspace.contains(logPath);
        }),
        { numRuns: 100 }
      );
    });

    it('prefix-similar paths are not contained', () => {
      // Paths that start with the workspace path but are actually siblings
      const suffixes = fc.constantFrom('2', '-backup', '_old', '.bak', 'extra');

      fc.assert(
        fc.property(suffixes, (suffix) => {
          const similarPath = testDir + suffix;
          return !workspace.contains(similarPath);
        }),
        { numRuns: 100 }
      );
    });
  });
});
