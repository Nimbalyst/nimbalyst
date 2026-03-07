import { describe, expect, it } from 'vitest';
import { extractTriggerMatch, getSlashTypeaheadScope } from '../typeaheadUtils';

describe('extractTriggerMatch', () => {
  it('matches slash triggers at the start of the input', () => {
    const value = '/review';
    const match = extractTriggerMatch(value, value.length, ['/']);

    expect(match).toEqual({
      trigger: '/',
      query: 'review',
      startIndex: 0,
      endIndex: value.length,
    });
    expect(getSlashTypeaheadScope(match)).toBe('commands');
  });

  it('matches slash triggers after whitespace for in-sentence skills', () => {
    const value = 'Please use /my-skill';
    const match = extractTriggerMatch(value, value.length, ['/']);

    expect(match).toEqual({
      trigger: '/',
      query: 'my-skill',
      startIndex: value.indexOf('/'),
      endIndex: value.length,
    });
    expect(getSlashTypeaheadScope(match)).toBe('skills');
  });

  it('does not match path-like slash sequences', () => {
    const value = 'Check /Users/ghinkle/project';
    const match = extractTriggerMatch(value, value.length, ['/']);

    expect(match).toBeNull();
  });
});
