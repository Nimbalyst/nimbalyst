/**
 * MobileSessionControlHandler
 *
 * Handles session control messages from mobile devices.
 * The sync layer passes generic messages - this handler interprets them
 * and dispatches to the appropriate AI session logic.
 */

import type { SyncProvider, SessionControlMessage } from '@nimbalyst/runtime/sync';
import { ProviderFactory } from '@nimbalyst/runtime/ai/server';
import type { BrowserWindow } from 'electron';
import { logger } from '../../utils/logger';

const log = logger.ai;

/**
 * Known control message types.
 * The handler interprets these - the sync layer doesn't care about them.
 */
export type ControlMessageType =
  | 'cancel'
  | 'question_response'
  | 'prompt';

interface CancelPayload {
  // No additional payload needed
}

interface QuestionResponsePayload {
  questionId: string;
  answers: Record<string, string>;
  cancelled?: boolean;
}

interface PromptPayload {
  promptId: string;
  prompt: string;
}

/**
 * Initialize the mobile session control handler.
 * Listens for control messages from the sync layer and dispatches to appropriate handlers.
 */
export function initMobileSessionControlHandler(
  syncProvider: SyncProvider,
  findWindowByWorkspace: (workspacePath: string) => BrowserWindow | null | undefined
): () => void {
  if (!syncProvider.onSessionControlMessage) {
    log.warn('Sync provider does not support session control messages');
    return () => {};
  }

  const cleanup = syncProvider.onSessionControlMessage((message) => {
    handleControlMessage(message, findWindowByWorkspace);
  });

  log.info('Mobile session control handler initialized');

  return cleanup;
}

/**
 * Dispatch a control message to the appropriate handler
 */
function handleControlMessage(
  message: SessionControlMessage,
  findWindowByWorkspace: (workspacePath: string) => BrowserWindow | null | undefined
): void {
  log.info('Received control message:', message.type, 'for session:', message.sessionId);

  switch (message.type) {
    case 'cancel':
      handleCancel(message.sessionId);
      break;

    case 'question_response': {
      const payload = message.payload as unknown as QuestionResponsePayload;
      handleQuestionResponse(
        message.sessionId,
        payload.questionId,
        payload.answers,
        payload.cancelled ?? false,
        findWindowByWorkspace
      );
      break;
    }

    case 'prompt': {
      // Prompts are handled via the queuedPrompts system, not control messages
      // This is here for future expansion if needed
      log.warn('Received prompt control message - prompts should use queuedPrompts system');
      break;
    }

    default:
      log.warn('Unknown control message type:', message.type);
  }
}

/**
 * Handle a cancel command
 */
function handleCancel(sessionId: string): void {
  const provider = ProviderFactory.getProvider('claude-code', sessionId);
  if (provider && 'abort' in provider) {
    log.info('Aborting session:', sessionId);
    (provider as { abort: () => void }).abort();

    // Notify renderer to update UI
    notifyAllWindows('ai:sessionCancelled', { sessionId });
  } else {
    log.warn('No provider found or provider does not support abort:', sessionId);
  }
}

/**
 * Handle a question response
 */
function handleQuestionResponse(
  sessionId: string,
  questionId: string,
  answers: Record<string, string>,
  cancelled: boolean,
  _findWindowByWorkspace: (workspacePath: string) => BrowserWindow | null | undefined
): void {
  const provider = ProviderFactory.getProvider('claude-code', sessionId);

  if (!provider) {
    log.warn('No provider found for session:', sessionId);
    return;
  }

  if (cancelled) {
    if ('rejectAskUserQuestion' in provider) {
      log.info('Rejecting question (cancelled):', questionId);
      (provider as { rejectAskUserQuestion: (questionId: string, error: Error) => void })
        .rejectAskUserQuestion(questionId, new Error('Question cancelled from mobile'));
    }
  } else {
    if ('resolveAskUserQuestion' in provider) {
      log.info('Resolving question:', questionId);
      (provider as { resolveAskUserQuestion: (questionId: string, answers: Record<string, string>, sessionId: string, source: string) => void })
        .resolveAskUserQuestion(questionId, answers, sessionId, 'mobile');
    }
  }

  // Notify renderer to clear the pending question UI
  notifyAllWindows('ai:askUserQuestionAnswered', {
    sessionId,
    questionId,
    answers,
    answeredBy: 'mobile',
    cancelled,
  });
}

/**
 * Helper to notify all windows
 */
async function notifyAllWindows(channel: string, data: Record<string, unknown>): Promise<void> {
  const { BrowserWindow } = await import('electron');
  const windows = BrowserWindow.getAllWindows().filter(w => !w.isDestroyed());
  for (const win of windows) {
    win.webContents.send(channel, data);
  }
}
