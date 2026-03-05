import { describe, expect, it } from 'vitest';
import { getMonacoTheme } from '../monacoUtils';

describe('getMonacoTheme', () => {
  it('maps built-in monokai theme ID to monaco monokai theme', () => {
    expect(getMonacoTheme('light', undefined, 'monokai')).toBe('monokai');
  });

  it('maps built-in solarized theme IDs to custom monaco themes', () => {
    expect(getMonacoTheme('light', undefined, 'solarized-light')).toBe('solarized-light');
    expect(getMonacoTheme('dark', undefined, 'solarized-dark')).toBe('solarized-dark');
  });

  it('preserves support for legacy namespaced theme IDs', () => {
    expect(getMonacoTheme('light', undefined, 'sample-themes:monokai')).toBe('monokai');
  });
});
