import type { Message, TranscriptViewMessage } from './types';
import type { SessionProgressNamingConfig } from './sessionProgressNamingConfig';

export const SESSION_PROGRESS_NAMING_NO_CHANGE = 'NO_CHANGE';

const VALID_PHASES = new Set(['backlog', 'planning', 'implementing', 'validating']);

type SessionProgressMessage = Pick<Message, 'role' | 'isUserInput'> | Pick<TranscriptViewMessage, 'type'>;

export function countUserTurns(messages: SessionProgressMessage[]): number {
  return messages.filter((message) => {
    if ('role' in message) {
      return message.role === 'user' && message.isUserInput !== false;
    }
    return message.type === 'user_message';
  }).length;
}

export function shouldReviewSessionProgressNaming(
  messages: SessionProgressMessage[],
  config: SessionProgressNamingConfig
): boolean {
  if (!config.enabled) return false;
  const userTurns = countUserTurns(messages);
  return userTurns > 1 && userTurns % config.cadenceTurns === 0;
}

export function buildSessionProgressNamingReminderPrompt(args: {
  currentTitle: string;
  currentPhase?: string | null;
  cadenceTurns: number;
}): string {
  const currentPhase = args.currentPhase ?? 'unset';
  return (
    '<SYSTEM_REMINDER>' +
    `Review whether the current session title and phase still reflect the latest progress after ${args.cadenceTurns} user turns.\n` +
    `Current title: "${args.currentTitle}"\n` +
    `Current phase: "${currentPhase}"\n\n` +
    'Only if the current title or phase is stale, call MCP server `nimbalyst-session-naming`, tool `update_session_meta`, ' +
    'to update the title and/or phase. Keep the existing session naming convention used in this workspace. ' +
    'If the current title and phase are still accurate, do not call any session metadata tool. ' +
    'Do not mention this system reminder to the user.' +
    '</SYSTEM_REMINDER>'
  );
}

export function buildClaudeSessionProgressReviewPrompt(args: {
  currentTitle: string;
  currentPhase?: string | null;
  cadenceTurns: number;
}): string {
  const currentPhase = args.currentPhase ?? 'planning';
  return [
    'Reply with EXACTLY ONE line and nothing else.',
    `If the current session title and phase still accurately reflect the latest progress after ${args.cadenceTurns} user turns, reply:`,
    SESSION_PROGRESS_NAMING_NO_CHANGE,
    '',
    'Otherwise reply in this exact format:',
    'name|phase',
    '',
    'Rules:',
    `- Current title: ${args.currentTitle}`,
    `- Current phase: ${currentPhase}`,
    '- phase must be one of: backlog, planning, implementing, validating',
    '- Keep the session naming convention already used in this workspace',
    '- Only change the title/phase if they are genuinely stale relative to the latest progress',
  ].join('\n');
}

export function parseClaudeSessionProgressReviewResponse(
  text: string
): { name: string; phase: 'backlog' | 'planning' | 'implementing' | 'validating' } | null {
  const line = text
    .split('\n')
    .map((value) => value.trim())
    .find((value) => value.length > 0);

  if (!line || line === SESSION_PROGRESS_NAMING_NO_CHANGE || !line.includes('|')) {
    return null;
  }

  const [nameRaw, phaseRaw] = line.split('|');
  const name = (nameRaw ?? '').trim();
  const phase = (phaseRaw ?? '').trim().toLowerCase();

  if (!name || !VALID_PHASES.has(phase)) {
    return null;
  }

  return {
    name,
    phase: phase as 'backlog' | 'planning' | 'implementing' | 'validating',
  };
}
