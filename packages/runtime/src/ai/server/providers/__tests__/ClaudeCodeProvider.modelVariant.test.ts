import { describe, it, expect } from 'vitest';
import { resolveClaudeCodeModelVariant } from '../../types';

const DEFAULT_MODEL = 'claude-code:sonnet';

describe('resolveClaudeCodeModelVariant', () => {
  describe('standard variants (no extended context)', () => {
    it('resolves sonnet variant', () => {
      expect(resolveClaudeCodeModelVariant('claude-code:sonnet', DEFAULT_MODEL)).toBe('sonnet');
    });

    it('resolves opus variant', () => {
      expect(resolveClaudeCodeModelVariant('claude-code:opus', DEFAULT_MODEL)).toBe('opus');
    });

    it('resolves haiku variant', () => {
      expect(resolveClaudeCodeModelVariant('claude-code:haiku', DEFAULT_MODEL)).toBe('haiku');
    });

    it('uses default model when config model is undefined', () => {
      expect(resolveClaudeCodeModelVariant(undefined, DEFAULT_MODEL)).toBe('sonnet');
    });

    it('uses default model when config model is empty string', () => {
      expect(resolveClaudeCodeModelVariant('', DEFAULT_MODEL)).toBe('sonnet');
    });
  });

  describe('extended context (1M) variants', () => {
    it('sonnet-1m resolves to sonnet[1m] (Sonnet 4.6)', () => {
      const result = resolveClaudeCodeModelVariant('claude-code:sonnet-1m', DEFAULT_MODEL);
      expect(result).toBe('sonnet[1m]');
    });

    it('opus-1m resolves to opus[1m]', () => {
      const result = resolveClaudeCodeModelVariant('claude-code:opus-1m', DEFAULT_MODEL);
      expect(result).toBe('opus[1m]');
    });

    it('haiku-1m resolves to haiku[1m]', () => {
      const result = resolveClaudeCodeModelVariant('claude-code:haiku-1m', DEFAULT_MODEL);
      expect(result).toBe('haiku[1m]');
    });
  });

  describe('SDK compatibility', () => {
    it('standard variants are valid SDK model values', () => {
      const validSdkValues = ['sonnet', 'opus', 'haiku'];
      for (const variant of validSdkValues) {
        const result = resolveClaudeCodeModelVariant(`claude-code:${variant}`, DEFAULT_MODEL);
        expect(validSdkValues).toContain(result);
      }
    });

    it('1M variants include [1m] suffix that SDK uses for beta auto-detection', () => {
      // The SDK checks model.includes("[1m]") to auto-add the context-1m-2025-08-07 beta.
      // This is critical because --betas is ignored for OAuth users.
      const variants = ['sonnet-1m', 'opus-1m', 'haiku-1m'];
      for (const variant of variants) {
        const result = resolveClaudeCodeModelVariant(`claude-code:${variant}`, DEFAULT_MODEL);
        expect(result).toContain('[1m]');
      }
    });

    it('standard variants do NOT include [1m] suffix', () => {
      const variants = ['sonnet', 'opus', 'haiku'];
      for (const variant of variants) {
        const result = resolveClaudeCodeModelVariant(`claude-code:${variant}`, DEFAULT_MODEL);
        expect(result).not.toContain('[1m]');
      }
    });
  });

  describe('fallback behavior', () => {
    it('falls back to sonnet for unrecognized provider', () => {
      expect(resolveClaudeCodeModelVariant('openai:gpt-4', DEFAULT_MODEL)).toBe('sonnet');
    });

    it('falls back to sonnet for unrecognized variant', () => {
      expect(resolveClaudeCodeModelVariant('claude-code:unknown', DEFAULT_MODEL)).toBe('sonnet');
    });

    it('handles raw variant names without provider prefix', () => {
      expect(resolveClaudeCodeModelVariant('sonnet', DEFAULT_MODEL)).toBe('sonnet');
    });

    it('handles raw variant names with -1m suffix', () => {
      expect(resolveClaudeCodeModelVariant('opus-1m', DEFAULT_MODEL)).toBe('opus[1m]');
    });
  });
});
