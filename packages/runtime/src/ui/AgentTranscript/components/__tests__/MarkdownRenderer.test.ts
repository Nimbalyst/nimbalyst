import { describe, expect, it } from 'vitest';
import { resolveTranscriptFilePathFromHref } from '../MarkdownRenderer';

describe('resolveTranscriptFilePathFromHref', () => {
  it('resolves unix absolute file paths', () => {
    expect(resolveTranscriptFilePathFromHref('/Users/test/project/src/file.ts')).toBe(
      '/Users/test/project/src/file.ts'
    );
  });

  it('strips line and column suffixes from file paths', () => {
    expect(resolveTranscriptFilePathFromHref('/Users/test/project/src/file.ts:42:7')).toBe(
      '/Users/test/project/src/file.ts'
    );
  });

  it('resolves file:// links and decodes path segments', () => {
    expect(resolveTranscriptFilePathFromHref('file:///Users/test/My%20Project/prompt.ts')).toBe(
      '/Users/test/My Project/prompt.ts'
    );
  });

  it('returns null for external web links', () => {
    expect(resolveTranscriptFilePathFromHref('https://nimbalyst.com/docs')).toBeNull();
  });

  it('returns null for non-absolute local paths', () => {
    expect(resolveTranscriptFilePathFromHref('src/ai/prompt.ts')).toBeNull();
  });
});
