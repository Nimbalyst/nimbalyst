/**
 * InteractiveWidgetHost Interface
 *
 * Provides communication between interactive tool widgets and the host (SessionTranscript).
 * Similar to EditorHost pattern - widgets receive a host object and call methods on it,
 * keeping the complex logic (atoms, callbacks, analytics) in the host implementation.
 *
 * This interface lives in runtime so widgets can use it without Electron-specific dependencies.
 */

// ============================================================
// AskUserQuestion Types
// ============================================================

export interface AskUserQuestionResponse {
  answers: Record<string, string>;
  cancelled?: boolean;
}

// ============================================================
// ExitPlanMode Types
// ============================================================

export interface ExitPlanModeResponse {
  approved: boolean;
  feedback?: string;
  startNewSession?: boolean;
}

// ============================================================
// Tool Permission Types
// ============================================================

export type PermissionScope = 'once' | 'session' | 'always' | 'always-all';

export interface ToolPermissionResponse {
  decision: 'allow' | 'deny';
  scope: PermissionScope;
}

// ============================================================
// Git Commit Types
// ============================================================

export interface GitCommitResponse {
  action: 'committed' | 'cancelled';
  commitHash?: string;
  error?: string;
}

// ============================================================
// Interactive Widget Host Interface
// ============================================================

export interface InteractiveWidgetHost {
  /**
   * Session and workspace context
   */
  sessionId: string;
  workspacePath: string;
  worktreeId?: string | null;

  // ============================================================
  // AskUserQuestion Operations
  // ============================================================

  /**
   * Submit answers to an AskUserQuestion tool call
   */
  askUserQuestionSubmit(questionId: string, answers: Record<string, string>): Promise<void>;

  /**
   * Cancel an AskUserQuestion tool call
   */
  askUserQuestionCancel(questionId: string): Promise<void>;

  // ============================================================
  // ExitPlanMode Operations
  // ============================================================

  /**
   * Approve exiting plan mode and switch to agent mode
   */
  exitPlanModeApprove(requestId: string): Promise<void>;

  /**
   * Approve and start a new implementation session
   * Handles workstream creation, worktree sessions, etc.
   */
  exitPlanModeStartNewSession(requestId: string, planFilePath: string): Promise<void>;

  /**
   * Deny exit and continue planning, optionally with feedback
   */
  exitPlanModeDeny(requestId: string, feedback?: string): Promise<void>;

  /**
   * Cancel the request and stop the session
   */
  exitPlanModeCancel(requestId: string): Promise<void>;

  // ============================================================
  // Tool Permission Operations
  // ============================================================

  /**
   * Submit a tool permission response (allow/deny with scope)
   */
  toolPermissionSubmit(requestId: string, response: ToolPermissionResponse): Promise<void>;

  /**
   * Cancel a tool permission request
   */
  toolPermissionCancel(requestId: string): Promise<void>;

  // ============================================================
  // Git Commit Operations
  // ============================================================

  /**
   * Execute a git commit with the given files and message.
   * Returns the commit result. On mobile, returns { pending: true } to indicate
   * the commit was sent to desktop but hasn't completed yet.
   */
  gitCommit(
    proposalId: string,
    files: string[],
    message: string
  ): Promise<{ success: boolean; commitHash?: string; error?: string; pending?: boolean }>;

  /**
   * Cancel a git commit proposal
   */
  gitCommitCancel(proposalId: string): Promise<void>;

  // ============================================================
  // Common Operations
  // ============================================================

  /**
   * Open a file in the editor
   */
  openFile(filePath: string): Promise<void>;

  /**
   * Track an analytics event
   */
  trackEvent(eventName: string, properties?: Record<string, unknown>): void;
}

// ============================================================
// No-op Host (for testing or when host is unavailable)
// ============================================================

export const noopInteractiveWidgetHost: InteractiveWidgetHost = {
  sessionId: '',
  workspacePath: '',
  worktreeId: null,

  askUserQuestionSubmit: async () => {
    console.warn('[InteractiveWidgetHost] No host available for askUserQuestionSubmit');
  },
  askUserQuestionCancel: async () => {
    console.warn('[InteractiveWidgetHost] No host available for askUserQuestionCancel');
  },

  exitPlanModeApprove: async () => {
    console.warn('[InteractiveWidgetHost] No host available for exitPlanModeApprove');
  },
  exitPlanModeStartNewSession: async () => {
    console.warn('[InteractiveWidgetHost] No host available for exitPlanModeStartNewSession');
  },
  exitPlanModeDeny: async () => {
    console.warn('[InteractiveWidgetHost] No host available for exitPlanModeDeny');
  },
  exitPlanModeCancel: async () => {
    console.warn('[InteractiveWidgetHost] No host available for exitPlanModeCancel');
  },

  toolPermissionSubmit: async () => {
    console.warn('[InteractiveWidgetHost] No host available for toolPermissionSubmit');
  },
  toolPermissionCancel: async () => {
    console.warn('[InteractiveWidgetHost] No host available for toolPermissionCancel');
  },

  gitCommit: async () => {
    console.warn('[InteractiveWidgetHost] No host available for gitCommit');
    return { success: false, error: 'No host available' };
  },
  gitCommitCancel: async () => {
    console.warn('[InteractiveWidgetHost] No host available for gitCommitCancel');
  },

  openFile: async () => {
    console.warn('[InteractiveWidgetHost] No host available for openFile');
  },
  trackEvent: () => {
    console.warn('[InteractiveWidgetHost] No host available for trackEvent');
  },
};
