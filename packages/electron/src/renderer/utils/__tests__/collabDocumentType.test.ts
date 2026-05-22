import { describe, expect, it } from 'vitest';
import { deriveCollabDocumentType } from '../collabDocumentType';

describe('deriveCollabDocumentType', () => {
  it('detects markdown files', () => {
    const registry = {
      findMatchForFile: () => undefined,
    };

    expect(deriveCollabDocumentType('Harness.md', registry)).toBe('markdown');
    expect(deriveCollabDocumentType('Harness.markdown', registry)).toBe('markdown');
  });

  it('preserves the full registered custom-editor suffix', () => {
    const registry = {
      findMatchForFile: () => ({
        key: '.mockup.html',
        registration: { collaboration: { supported: true } },
      }),
    };

    expect(deriveCollabDocumentType('deep-dive.mockup.html', registry as any)).toBe('mockup.html');
  });

  it('rejects non-collaborative custom editors', () => {
    const registry = {
      findMatchForFile: () => ({
        key: '.foo',
        registration: { collaboration: { supported: false } },
      }),
    };

    expect(deriveCollabDocumentType('test.foo', registry as any)).toBeNull();
  });
});
