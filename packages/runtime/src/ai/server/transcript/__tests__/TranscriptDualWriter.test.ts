import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTranscriptAdapter, safeTranscriptCall } from '../TranscriptDualWriter';
import { TranscriptEventRepository } from '../../../../storage/repositories/TranscriptEventRepository';

describe('TranscriptDualWriter', () => {
  afterEach(() => {
    TranscriptEventRepository.clearStore();
  });

  describe('createTranscriptAdapter', () => {
    it('returns null when no store is available', () => {
      // TranscriptEventRepository has no store set
      const adapter = createTranscriptAdapter('claude-code', 'session-1');
      expect(adapter).toBeNull();
    });
  });

  describe('safeTranscriptCall', () => {
    it('catches and logs errors without throwing', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await expect(
        safeTranscriptCall(async () => {
          throw new Error('boom');
        }, 'test context'),
      ).resolves.toBeUndefined();

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[TranscriptDualWriter] test context failed:'),
        expect.any(Error),
      );

      warnSpy.mockRestore();
    });

    it('returns undefined on error', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await safeTranscriptCall(async () => {
        throw new Error('boom');
      });

      expect(result).toBeUndefined();

      vi.restoreAllMocks();
    });

    it('passes through normal function calls correctly', async () => {
      let called = false;

      await safeTranscriptCall(async () => {
        called = true;
      });

      expect(called).toBe(true);
    });
  });
});
