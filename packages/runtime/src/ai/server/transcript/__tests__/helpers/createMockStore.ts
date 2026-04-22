import type { ITranscriptEventStore, TranscriptEvent } from '../../types';

/**
 * In-memory mock implementation of ITranscriptEventStore for tests.
 */
export function createMockStore(): ITranscriptEventStore {
  const events: TranscriptEvent[] = [];
  let nextId = 1;
  const sequenceCounters = new Map<string, number>();

  return {
    async insertEvent(event) {
      const id = nextId++;
      const full: TranscriptEvent = { ...event, id };
      events.push(full);
      const seq = sequenceCounters.get(event.sessionId) ?? 0;
      sequenceCounters.set(event.sessionId, Math.max(seq, event.sequence + 1));
      return full;
    },

    async updateEventPayload(id, payload) {
      const event = events.find((e) => e.id === id);
      if (event) {
        event.payload = payload;
      }
    },

    async mergeEventPayload(id, partialPayload) {
      const event = events.find((e) => e.id === id);
      if (event) {
        event.payload = { ...event.payload, ...partialPayload };
      }
    },

    async getSessionEvents(sessionId, options) {
      let result = events
        .filter((e) => e.sessionId === sessionId)
        .sort((a, b) => a.sequence - b.sequence);
      if (options?.eventTypes) {
        result = result.filter((e) => options.eventTypes!.includes(e.eventType));
      }
      if (options?.createdAfter) {
        const after = options.createdAfter.getTime();
        result = result.filter((e) => e.createdAt.getTime() >= after);
      }
      if (options?.createdBefore) {
        const before = options.createdBefore.getTime();
        result = result.filter((e) => e.createdAt.getTime() <= before);
      }
      const offset = options?.offset ?? 0;
      const limit = options?.limit ?? result.length;
      return result.slice(offset, offset + limit);
    },

    async getNextSequence(sessionId) {
      return sequenceCounters.get(sessionId) ?? 0;
    },

    async findByProviderToolCallId(providerToolCallId, sessionId) {
      return (
        events.find(
          (e) => e.providerToolCallId === providerToolCallId && e.sessionId === sessionId,
        ) ?? null
      );
    },

    async getEventById(id) {
      return events.find((e) => e.id === id) ?? null;
    },

    async getChildEvents(parentEventId) {
      return events
        .filter((e) => e.parentEventId === parentEventId)
        .sort((a, b) => a.sequence - b.sequence);
    },

    async getSubagentEvents(subagentId, sessionId) {
      return events
        .filter((e) => e.subagentId === subagentId && e.sessionId === sessionId)
        .sort((a, b) => a.sequence - b.sequence);
    },

    async getMultiSessionEvents(sessionIds, options) {
      let result = events
        .filter((e) => sessionIds.includes(e.sessionId))
        .sort((a, b) => {
          if (a.sessionId !== b.sessionId) return a.sessionId.localeCompare(b.sessionId);
          return a.sequence - b.sequence;
        });
      if (options?.eventTypes) {
        result = result.filter((e) => options.eventTypes!.includes(e.eventType));
      }
      if (options?.createdAfter) {
        const after = options.createdAfter.getTime();
        result = result.filter((e) => e.createdAt.getTime() >= after);
      }
      if (options?.createdBefore) {
        const before = options.createdBefore.getTime();
        result = result.filter((e) => e.createdAt.getTime() <= before);
      }
      return result;
    },

    async searchSessions(query, options) {
      const lowerQuery = query.toLowerCase();
      let result = events.filter(
        (e) => e.searchable && e.searchableText?.toLowerCase().includes(lowerQuery),
      );
      if (options?.sessionIds) {
        result = result.filter((e) => options.sessionIds!.includes(e.sessionId));
      }
      const limit = options?.limit ?? 100;
      return result.slice(0, limit).map((e) => ({ event: e, sessionId: e.sessionId }));
    },

    async getTailEvents(sessionId, count, options) {
      let result = events
        .filter((e) => e.sessionId === sessionId)
        .sort((a, b) => a.sequence - b.sequence);
      if (options?.excludeEventTypes) {
        result = result.filter((e) => !options.excludeEventTypes!.includes(e.eventType));
      }
      return result.slice(-count);
    },

    async deleteSessionEvents(sessionId) {
      const toRemove = events.filter((e) => e.sessionId === sessionId);
      for (const e of toRemove) {
        events.splice(events.indexOf(e), 1);
      }
      sequenceCounters.delete(sessionId);
    },
  };
}
