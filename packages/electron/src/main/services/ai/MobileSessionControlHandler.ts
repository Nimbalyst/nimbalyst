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
import type { PermissionScope } from '@nimbalyst/runtime';

const log = logger.ai;

/**
 * Known control message types.
 * The handler interprets these - the sync layer doesn't care about them.
 */
export type ControlMessageType =
  | 'cancel'
  | 'question_response'  // Legacy - kept for backwards compatibility
  | 'prompt_response'    // New unified prompt response type
  | 'prompt';

// ============================================================
// Payload Types
// ============================================================

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
 * Unified prompt response payload.
 * All interactive prompts use this structure.
 */
interface PromptResponsePayload {
  promptType: 'ask_user_question' | 'exit_plan_mode' | 'tool_permission' | 'git_commit';
  promptId: string;
  response: AskUserQuestionResponse | ExitPlanModeResponse | ToolPermissionResponse | GitCommitResponse;
}

interface AskUserQuestionResponse {
  answers: Record<string, string>;
  cancelled?: boolean;
}

interface ExitPlanModeResponse {
  approved: boolean;
  feedback?: string;
  startNewSession?: boolean;
}

interface ToolPermissionResponse {
  decision: 'allow' | 'deny';
  scope: PermissionScope;
}

interface GitCommitResponse {
  action: 'committed' | 'cancelled';
  files?: string[];
  message?: string;
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

    // Legacy handler - kept for backwards compatibility with older mobile versions
    case 'question_response': {
      const payload = message.payload as unknown as QuestionResponsePayload;
      handleAskUserQuestionResponse(
        message.sessionId,
        payload.questionId,
        payload.answers,
        payload.cancelled ?? false,
        findWindowByWorkspace
      );
      break;
    }

    // New unified prompt response handler
    case 'prompt_response': {
      const payload = message.payload as unknown as PromptResponsePayload;
      handlePromptResponse(
        message.sessionId,
        payload,
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
 * Handle unified prompt response - dispatches to type-specific handlers
 */
function handlePromptResponse(
  sessionId: string,
  payload: PromptResponsePayload,
  findWindowByWorkspace: (workspacePath: string) => BrowserWindow | null | undefined
): void {
  log.info('Handling prompt response:', payload.promptType, 'promptId:', payload.promptId);

  switch (payload.promptType) {
    case 'ask_user_question': {
      const response = payload.response as AskUserQuestionResponse;
      handleAskUserQuestionResponse(
        sessionId,
        payload.promptId,
        response.answers,
        response.cancelled ?? false,
        findWindowByWorkspace
      );
      break;
    }

    case 'exit_plan_mode': {
      const response = payload.response as ExitPlanModeResponse;
      handleExitPlanModeResponse(
        sessionId,
        payload.promptId,
        response,
        findWindowByWorkspace
      );
      break;
    }

    case 'tool_permission': {
      const response = payload.response as ToolPermissionResponse;
      handleToolPermissionResponse(
        sessionId,
        payload.promptId,
        response,
        findWindowByWorkspace
      );
      break;
    }

    case 'git_commit': {
      const response = payload.response as GitCommitResponse;
      handleGitCommitResponse(
        sessionId,
        payload.promptId,
        response,
        findWindowByWorkspace
      );
      break;
    }

    default:
      log.warn('Unknown prompt type:', payload.promptType);
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

// ============================================================
// Prompt-Specific Handlers
// ============================================================

/**
 * Handle AskUserQuestion response from mobile
 */
function handleAskUserQuestionResponse(
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
 * Handle ExitPlanMode response from mobile
 */
function handleExitPlanModeResponse(
  sessionId: string,
  promptId: string,
  response: ExitPlanModeResponse,
  _findWindowByWorkspace: (workspacePath: string) => BrowserWindow | null | undefined
): void {
  log.info('Handling ExitPlanMode response:', promptId, 'approved:', response.approved);

  // Get the provider to resolve the SDK's pending promise
  const provider = ProviderFactory.getProvider('claude-code', sessionId);

  if (!provider) {
    log.warn('No provider found for session:', sessionId);
    return;
  }

  // Call resolveExitPlanModeConfirmation on the provider to resolve the SDK's pending promise
  if ('resolveExitPlanModeConfirmation' in provider) {
    log.info('Resolving ExitPlanMode confirmation:', promptId, 'approved:', response.approved);
    (provider as { resolveExitPlanModeConfirmation: (requestId: string, response: { approved: boolean; clearContext?: boolean; feedback?: string }, sessionId: string, source: string) => void })
      .resolveExitPlanModeConfirmation(
        promptId,
        {
          approved: response.approved,
          clearContext: response.startNewSession,
          feedback: response.feedback,
        },
        sessionId,
        'mobile'
      );
  }

  // Notify renderer to update the UI
  notifyAllWindows('ai:exitPlanModeResponse', {
    sessionId,
    promptId,
    approved: response.approved,
    feedback: response.feedback,
    startNewSession: response.startNewSession,
    answeredBy: 'mobile',
  });
}

/**
 * Handle ToolPermission response from mobile
 */
function handleToolPermissionResponse(
  sessionId: string,
  promptId: string,
  response: ToolPermissionResponse,
  _findWindowByWorkspace: (workspacePath: string) => BrowserWindow | null | undefined
): void {
  log.info('Handling ToolPermission response:', promptId, 'decision:', response.decision, 'scope:', response.scope);

  // Notify renderer to handle the permission response
  notifyAllWindows('ai:toolPermissionResponse', {
    sessionId,
    promptId,
    decision: response.decision,
    scope: response.scope,
    answeredBy: 'mobile',
  });
}

/**
 * Handle GitCommit response from mobile
 * Mobile can approve the commit, but desktop must execute it
 */
async function handleGitCommitResponse(
  sessionId: string,
  promptId: string,
  response: GitCommitResponse,
  findWindowByWorkspace: (workspacePath: string) => BrowserWindow | null | undefined
): Promise<void> {
  log.info('Handling GitCommit response:', promptId, 'action:', response.action);

  if (response.action === 'cancelled') {
    // Just notify renderer that commit was cancelled
    notifyAllWindows('ai:gitCommitResponse', {
      sessionId,
      promptId,
      action: 'cancelled',
      answeredBy: 'mobile',
    });
    return;
  }

  // For 'committed' action, we need to execute the git commit on desktop
  // and then notify with the result
  if (!response.files || !response.message) {
    log.error('GitCommit response missing files or message');
    notifyAllWindows('ai:gitCommitResponse', {
      sessionId,
      promptId,
      action: 'error',
      error: 'Missing files or message',
      answeredBy: 'mobile',
    });
    return;
  }

  // Notify renderer to execute the commit
  // The renderer will call the git:commit IPC and respond via messages:respond-to-prompt
  notifyAllWindows('ai:gitCommitRequest', {
    sessionId,
    promptId,
    files: response.files,
    message: response.message,
    answeredBy: 'mobile',
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
