import { describe, expect, it } from 'vitest';
import { parseCodexEvent } from '../codexEventParser';

describe('parseCodexEvent token_count parsing', () => {
  it('extracts usage and context snapshot from event_msg token_count payload', () => {
    const parsed = parseCodexEvent({
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          model_context_window: 258400,
          last_token_usage: {
            input_tokens: 100452,
            output_tokens: 76,
            total_tokens: 100528,
          },
        },
      },
    });

    const usageEvent = parsed.find((event) => event.usage || event.contextSnapshot);
    expect(usageEvent).toBeDefined();
    expect(usageEvent?.usage).toEqual({
      input_tokens: 100452,
      output_tokens: 76,
      total_tokens: 100528,
    });
    expect(usageEvent?.contextSnapshot).toEqual({
      contextFillTokens: 100452,
      contextWindow: 258400,
    });
  });

  it('falls back to flat info usage for direct token_count events', () => {
    const parsed = parseCodexEvent({
      type: 'token_count',
      info: {
        input_tokens: 12,
        output_tokens: 3,
        total_tokens: 15,
        model_context_window: 200000,
      },
    });

    const usageEvent = parsed.find((event) => event.usage || event.contextSnapshot);
    expect(usageEvent).toBeDefined();
    expect(usageEvent?.usage).toEqual({
      input_tokens: 12,
      output_tokens: 3,
      total_tokens: 15,
    });
    expect(usageEvent?.contextSnapshot).toEqual({
      contextFillTokens: 12,
      contextWindow: 200000,
    });
  });
});
