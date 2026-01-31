import { describe, it, expect, beforeEach } from 'vitest';
import { DocumentContextService } from '../DocumentContextService';
import type { RawDocumentContext } from '../types';

describe('DocumentContextService', () => {
  let service: DocumentContextService;

  beforeEach(() => {
    service = new DocumentContextService();
  });

  describe('prepareContext', () => {
    describe('document transitions', () => {
      it('detects "opened" transition when first viewing a file', () => {
        const rawContext: RawDocumentContext = {
          filePath: '/test/file.ts',
          fileType: 'typescript',
          content: 'const x = 1;',
        };

        const result = service.prepareContext(rawContext, 'session-1', 'claude', undefined);

        expect(result.documentContext.documentTransition).toBe('opened');
        expect(result.documentContext.filePath).toBe('/test/file.ts');
        expect(result.documentContext.content).toBe('const x = 1;');
        expect(result.documentContext.documentDiff).toBeUndefined();
      });

      it('detects "none" transition when content is unchanged', () => {
        const rawContext: RawDocumentContext = {
          filePath: '/test/file.ts',
          fileType: 'typescript',
          content: 'const x = 1;',
        };

        // First message - opened
        service.prepareContext(rawContext, 'session-1', 'claude', undefined);

        // Second message - same content
        const result = service.prepareContext(rawContext, 'session-1', 'claude', undefined);

        expect(result.documentContext.documentTransition).toBe('none');
        expect(result.documentContext.content).toBe('const x = 1;');
      });

      it('detects "modified" transition when content changes', () => {
        const rawContext1: RawDocumentContext = {
          filePath: '/test/file.ts',
          fileType: 'typescript',
          content: 'const x = 1;',
        };

        const rawContext2: RawDocumentContext = {
          filePath: '/test/file.ts',
          fileType: 'typescript',
          content: 'const x = 2;',
        };

        // First message - opened
        service.prepareContext(rawContext1, 'session-1', 'claude', undefined);

        // Second message - modified
        const result = service.prepareContext(rawContext2, 'session-1', 'claude', undefined);

        expect(result.documentContext.documentTransition).toBe('modified');
      });

      it('detects "switched" transition when changing files', () => {
        const rawContext1: RawDocumentContext = {
          filePath: '/test/file1.ts',
          fileType: 'typescript',
          content: 'const x = 1;',
        };

        const rawContext2: RawDocumentContext = {
          filePath: '/test/file2.ts',
          fileType: 'typescript',
          content: 'const y = 2;',
        };

        // First message - opened file1
        service.prepareContext(rawContext1, 'session-1', 'claude', undefined);

        // Second message - switched to file2
        const result = service.prepareContext(rawContext2, 'session-1', 'claude', undefined);

        expect(result.documentContext.documentTransition).toBe('switched');
        expect(result.documentContext.previousFilePath).toBe('/test/file1.ts');
        expect(result.documentContext.filePath).toBe('/test/file2.ts');
      });

      it('detects "closed" transition when no longer viewing any file', () => {
        const rawContext: RawDocumentContext = {
          filePath: '/test/file.ts',
          fileType: 'typescript',
          content: 'const x = 1;',
        };

        // First message - opened
        service.prepareContext(rawContext, 'session-1', 'claude', undefined);

        // Second message - no file
        const result = service.prepareContext(undefined, 'session-1', 'claude', undefined);

        expect(result.documentContext.documentTransition).toBe('closed');
        expect(result.documentContext.previousFilePath).toBe('/test/file.ts');
      });
    });

    describe('content vs diff decision', () => {
      it('sends full content for non-claude-code providers', () => {
        const rawContext1: RawDocumentContext = {
          filePath: '/test/file.ts',
          fileType: 'typescript',
          content: 'const x = 1;',
        };

        const rawContext2: RawDocumentContext = {
          filePath: '/test/file.ts',
          fileType: 'typescript',
          content: 'const x = 2;',
        };

        service.prepareContext(rawContext1, 'session-1', 'claude', undefined);
        const result = service.prepareContext(rawContext2, 'session-1', 'claude', undefined);

        expect(result.documentContext.content).toBe('const x = 2;');
        expect(result.documentContext.documentDiff).toBeUndefined();
      });

      it('sends diff instead of content for claude-code on modified transition', () => {
        // Use a larger file so the diff is smaller than the full content
        const largeContent1 = `// This is a test file with lots of content
function test1() {
  console.log('test1');
}

function test2() {
  console.log('test2');
}

function test3() {
  console.log('test3');
}

function test4() {
  console.log('test4');
}

const x = 1;

function test5() {
  console.log('test5');
}

function test6() {
  console.log('test6');
}
`;

        const largeContent2 = `// This is a test file with lots of content
function test1() {
  console.log('test1');
}

function test2() {
  console.log('test2');
}

function test3() {
  console.log('test3');
}

function test4() {
  console.log('test4');
}

const x = 2;

function test5() {
  console.log('test5');
}

function test6() {
  console.log('test6');
}
`;

        const rawContext1: RawDocumentContext = {
          filePath: '/test/file.ts',
          fileType: 'typescript',
          content: largeContent1,
        };

        const rawContext2: RawDocumentContext = {
          filePath: '/test/file.ts',
          fileType: 'typescript',
          content: largeContent2,
        };

        service.prepareContext(rawContext1, 'session-1', 'claude-code', undefined);
        const result = service.prepareContext(rawContext2, 'session-1', 'claude-code', undefined);

        expect(result.documentContext.documentTransition).toBe('modified');
        expect(result.documentContext.content).toBeUndefined();
        expect(result.documentContext.documentDiff).toBeDefined();
        expect(result.documentContext.documentDiff).toContain('-const x = 1;');
        expect(result.documentContext.documentDiff).toContain('+const x = 2;');
      });

      it('sends full content for claude-code on opened transition', () => {
        const rawContext: RawDocumentContext = {
          filePath: '/test/file.ts',
          fileType: 'typescript',
          content: 'const x = 1;',
        };

        const result = service.prepareContext(rawContext, 'session-1', 'claude-code', undefined);

        expect(result.documentContext.documentTransition).toBe('opened');
        expect(result.documentContext.content).toBe('const x = 1;');
        expect(result.documentContext.documentDiff).toBeUndefined();
      });
    });

    describe('text selection normalization', () => {
      it('normalizes textSelection object format', () => {
        const rawContext: RawDocumentContext = {
          filePath: '/test/file.ts',
          fileType: 'typescript',
          content: 'const x = 1;',
          textSelection: {
            text: 'const x',
            filePath: '/test/file.ts',
            timestamp: 123456,
          },
        };

        const result = service.prepareContext(rawContext, 'session-1', 'claude', undefined);

        expect(result.documentContext.textSelection).toEqual({
          text: 'const x',
          filePath: '/test/file.ts',
          timestamp: 123456,
        });
      });

      it('normalizes selection as object with text/filePath/timestamp', () => {
        const rawContext: RawDocumentContext = {
          filePath: '/test/file.ts',
          fileType: 'typescript',
          content: 'const x = 1;',
          selection: {
            text: 'const x',
            filePath: '/test/file.ts',
            timestamp: 123456,
          },
        };

        const result = service.prepareContext(rawContext, 'session-1', 'claude', undefined);

        expect(result.documentContext.textSelection).toEqual({
          text: 'const x',
          filePath: '/test/file.ts',
          timestamp: 123456,
        });
      });

      it('normalizes selection as string (legacy format)', () => {
        const rawContext: RawDocumentContext = {
          filePath: '/test/file.ts',
          fileType: 'typescript',
          content: 'const x = 1;',
          selection: 'const x',
          textSelectionTimestamp: 123456,
        };

        const result = service.prepareContext(rawContext, 'session-1', 'claude', undefined);

        expect(result.documentContext.textSelection).toEqual({
          text: 'const x',
          filePath: '/test/file.ts',
          timestamp: 123456,
        });
      });

      it('returns undefined when no selection present', () => {
        const rawContext: RawDocumentContext = {
          filePath: '/test/file.ts',
          fileType: 'typescript',
          content: 'const x = 1;',
        };

        const result = service.prepareContext(rawContext, 'session-1', 'claude', undefined);

        expect(result.documentContext.textSelection).toBeUndefined();
      });
    });

    describe('user message additions', () => {
      it('adds plan mode instructions when entering plan mode', () => {
        const rawContext: RawDocumentContext = {
          filePath: '/test/file.ts',
          fileType: 'typescript',
          content: 'const x = 1;',
        };

        const result = service.prepareContext(rawContext, 'session-1', 'claude', {
          enteringPlanMode: true,
          planFilePath: '/plans/test-plan.md',
        });

        expect(result.userMessageAdditions.planModeInstructions).toBeDefined();
        expect(result.userMessageAdditions.planModeInstructions).toContain('PLAN_MODE_ACTIVATED');
        expect(result.userMessageAdditions.planModeInstructions).toContain('PLANNING MODE ONLY');
      });

      it('adds plan mode deactivation when exiting plan mode', () => {
        const rawContext: RawDocumentContext = {
          filePath: '/test/file.ts',
          fileType: 'typescript',
          content: 'const x = 1;',
        };

        const result = service.prepareContext(rawContext, 'session-1', 'claude', {
          exitingPlanMode: true,
        });

        expect(result.userMessageAdditions.planModeDeactivation).toBeDefined();
        expect(result.userMessageAdditions.planModeDeactivation).toContain('PLAN_MODE_DEACTIVATED');
      });

      it('returns empty additions when no mode transition', () => {
        const rawContext: RawDocumentContext = {
          filePath: '/test/file.ts',
          fileType: 'typescript',
          content: 'const x = 1;',
        };

        const result = service.prepareContext(rawContext, 'session-1', 'claude', undefined);

        expect(result.userMessageAdditions.planModeInstructions).toBeUndefined();
        expect(result.userMessageAdditions.planModeDeactivation).toBeUndefined();
      });
    });
  });

  describe('session state management', () => {
    it('tracks state per session independently', () => {
      const rawContext1: RawDocumentContext = {
        filePath: '/test/file1.ts',
        fileType: 'typescript',
        content: 'const x = 1;',
      };

      const rawContext2: RawDocumentContext = {
        filePath: '/test/file2.ts',
        fileType: 'typescript',
        content: 'const y = 2;',
      };

      // Session 1
      const result1a = service.prepareContext(rawContext1, 'session-1', 'claude', undefined);
      expect(result1a.documentContext.documentTransition).toBe('opened');

      // Session 2
      const result2a = service.prepareContext(rawContext2, 'session-2', 'claude', undefined);
      expect(result2a.documentContext.documentTransition).toBe('opened');

      // Session 1 again - should remember state
      const result1b = service.prepareContext(rawContext1, 'session-1', 'claude', undefined);
      expect(result1b.documentContext.documentTransition).toBe('none');
    });

    it('clears session state', () => {
      const rawContext: RawDocumentContext = {
        filePath: '/test/file.ts',
        fileType: 'typescript',
        content: 'const x = 1;',
      };

      service.prepareContext(rawContext, 'session-1', 'claude', undefined);
      expect(service.getSessionState('session-1')).toBeDefined();

      service.clearSessionState('session-1');
      expect(service.getSessionState('session-1')).toBeUndefined();

      // Next message should be "opened" again
      const result = service.prepareContext(rawContext, 'session-1', 'claude', undefined);
      expect(result.documentContext.documentTransition).toBe('opened');
    });

    it('automatically clears state on closed transition', () => {
      const rawContext: RawDocumentContext = {
        filePath: '/test/file.ts',
        fileType: 'typescript',
        content: 'const x = 1;',
      };

      service.prepareContext(rawContext, 'session-1', 'claude', undefined);
      expect(service.getSessionState('session-1')).toBeDefined();

      service.prepareContext(undefined, 'session-1', 'claude', undefined);
      expect(service.getSessionState('session-1')).toBeUndefined();
    });

    it('returns cached session state for debugging', () => {
      const rawContext: RawDocumentContext = {
        filePath: '/test/file.ts',
        fileType: 'typescript',
        content: 'const x = 1;',
      };

      service.prepareContext(rawContext, 'session-1', 'claude', undefined);

      const state = service.getSessionState('session-1');
      expect(state).toBeDefined();
      expect(state?.filePath).toBe('/test/file.ts');
      expect(state?.content).toBe('const x = 1;');
      expect(state?.contentHash).toBeDefined();
    });
  });
});
