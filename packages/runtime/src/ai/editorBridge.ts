import type { StreamingConfig } from './types';

export interface TextReplacement {
  oldText: string;
  newText: string;
}

function getBridge(): any {
  const bridge = (globalThis as any).aiChatBridge;
  if (!bridge) throw new Error('Editor bridge not available');
  return bridge;
}

export function startStreamingEdit(config: StreamingConfig & { id: string }) {
  const bridge = getBridge();
  bridge.startStreamingEdit(config as any);
}

export function streamContent(streamId: string, content: string) {
  const bridge = getBridge();
  bridge.streamContent(streamId, content);
}

export function endStreamingEdit(streamId: string) {
  const bridge = getBridge();
  bridge.endStreamingEdit(streamId);
}

export async function applyReplacements(replacements: TextReplacement[]) {
  const bridge = getBridge();
  if (typeof bridge.applyReplacements !== 'function') {
    throw new Error('Editor bridge cannot apply replacements');
  }
  return await bridge.applyReplacements(replacements);
}
