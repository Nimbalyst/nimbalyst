/**
 * Service for preparing document context for AI providers.
 *
 * Extracts and centralizes logic for:
 * - Document transition detection (opened/closed/switched/modified)
 * - Diff computation for modified documents
 * - Content vs diff decision based on provider type
 * - User message additions (plan mode instructions)
 */

import { hashContent, computeDiff } from '../../utils/documentDiff';
import type { AIProviderType } from '../server/types';
import type {
  IDocumentContextService,
  RawDocumentContext,
  DocumentState,
  DocumentTransition,
  TransitionResult,
  PreparedDocumentContext,
  UserMessageAdditions,
  ContextPreparationResult,
  ModeTransition,
  TextSelection,
  PersistedDocumentState,
  PersistDocumentStateCallback,
} from './types';

export class DocumentContextService implements IDocumentContextService {
  /** Per-session document state for transition detection */
  private lastDocumentStateBySession: Map<string, DocumentState> = new Map();

  /** Callback to persist state changes to database */
  private persistCallback: PersistDocumentStateCallback | null = null;

  /** Debug logging enabled flag */
  private debugEnabled = true;

  private debug(message: string, data?: Record<string, unknown>): void {
    if (this.debugEnabled) {
      const dataStr = data ? ` ${JSON.stringify(data, null, 2)}` : '';
      console.log(`[DocumentContextService] ${message}${dataStr}`);
    }
  }

  prepareContext(
    rawContext: RawDocumentContext | undefined,
    sessionId: string,
    providerType: AIProviderType,
    modeTransition?: ModeTransition
  ): ContextPreparationResult {
    this.debug('prepareContext INPUT', {
      sessionId,
      providerType,
      hasRawContext: !!rawContext,
      filePath: rawContext?.filePath,
      contentLength: rawContext?.content?.length,
      contentHash: rawContext?.content ? hashContent(rawContext.content) : undefined,
      hasSelection: !!rawContext?.selection || !!rawContext?.textSelection,
    });

    // 1. Compute document transition
    const transitionResult = this.computeTransition(rawContext, sessionId);

    // 2. Update cached state and persist
    if (transitionResult.newState) {
      this.lastDocumentStateBySession.set(sessionId, transitionResult.newState);
      // Persist to database (fire and forget - don't block on persistence)
      this.persistState(sessionId, {
        filePath: transitionResult.newState.filePath,
        contentHash: transitionResult.newState.contentHash,
      });
    } else if (transitionResult.transition === 'closed') {
      this.lastDocumentStateBySession.delete(sessionId);
      // Clear persisted state
      this.persistState(sessionId, null);
    }

    // 3. Build document context (decide content vs diff)
    const documentContext = this.buildDocumentContext(
      rawContext,
      transitionResult,
      providerType
    );

    // 4. Build user message additions
    const userMessageAdditions = this.buildUserMessageAdditions(modeTransition);

    this.debug('prepareContext OUTPUT', {
      sessionId,
      transition: transitionResult.transition,
      outputFilePath: documentContext.filePath,
      hasContent: !!documentContext.content,
      contentLength: documentContext.content?.length,
      hasDiff: !!documentContext.documentDiff,
      diffLength: documentContext.documentDiff?.length,
      hasTextSelection: !!documentContext.textSelection,
      hasPlanModeInstructions: !!userMessageAdditions.planModeInstructions,
    });

    return { documentContext, userMessageAdditions };
  }

  clearSessionState(sessionId: string): void {
    this.lastDocumentStateBySession.delete(sessionId);
    // Also clear persisted state
    this.persistState(sessionId, null);
  }

  getSessionState(sessionId: string): DocumentState | undefined {
    return this.lastDocumentStateBySession.get(sessionId);
  }

  loadPersistedState(sessionId: string, state: PersistedDocumentState): void {
    // Load persisted state into memory cache.
    // Note: We don't have the content, only the hash. This means:
    // - If file hasn't changed (same hash), transition will be 'none'
    // - If file has changed (different hash), transition will be 'modified' but NO diff
    //   (since we don't have old content to diff against)
    // This is acceptable - we lose diff optimization for one message after restart.
    this.lastDocumentStateBySession.set(sessionId, {
      filePath: state.filePath,
      content: '', // Empty - we can't compute diffs without previous content
      contentHash: state.contentHash,
    });
  }

  setPersistCallback(callback: PersistDocumentStateCallback): void {
    this.persistCallback = callback;
  }

  /**
   * Persist state to database via callback (fire and forget).
   */
  private persistState(sessionId: string, state: PersistedDocumentState | null): void {
    if (this.persistCallback) {
      // Don't await - persistence is best-effort and shouldn't block the main flow
      this.persistCallback(sessionId, state).catch((err) => {
        // Log but don't throw - persistence failure shouldn't break the service
        console.error('[DocumentContextService] Failed to persist state:', err);
      });
    }
  }

  /**
   * Compute the document transition between the last state and current context.
   *
   * Logic extracted from AIService.computeDocumentTransition.
   */
  private computeTransition(
    rawContext: RawDocumentContext | undefined,
    sessionId: string
  ): TransitionResult {
    const lastState = this.lastDocumentStateBySession.get(sessionId) || null;

    this.debug('computeTransition', {
      sessionId,
      hasLastState: !!lastState,
      lastFilePath: lastState?.filePath,
      lastContentHash: lastState?.contentHash,
      currentFilePath: rawContext?.filePath,
      currentContentLength: rawContext?.content?.length,
    });

    // Case 1: No document context (user not viewing any file)
    if (!rawContext || !rawContext.filePath || !rawContext.content) {
      if (lastState?.filePath) {
        // Had a document before, now none - 'closed' transition
        return {
          transition: 'closed',
          newState: null,
          previousFilePath: lastState.filePath,
        };
      }
      // No document before or now
      return { transition: 'none', newState: null };
    }

    // Compute hash of current content
    const currentHash = hashContent(rawContext.content);
    const newState: DocumentState = {
      filePath: rawContext.filePath,
      content: rawContext.content,
      contentHash: currentHash,
    };

    // Case 2: No previous state - 'opened' transition (first time seeing a file)
    if (!lastState) {
      return {
        transition: 'opened',
        newState,
      };
    }

    // Case 3: Different file - 'switched' transition
    if (lastState.filePath !== rawContext.filePath) {
      return {
        transition: 'switched',
        newState,
        previousFilePath: lastState.filePath,
      };
    }

    // Case 4: Same file, same content - 'none' transition (unchanged)
    if (lastState.contentHash === currentHash) {
      return {
        transition: 'none',
        newState,
      };
    }

    // Case 5: Same file, different content - 'modified' transition
    // Compute a diff to show what changed
    const diff = computeDiff(lastState.content, rawContext.content, rawContext.filePath);

    return {
      transition: 'modified',
      newState,
      documentDiff: diff, // May be undefined if diff is larger than content
    };
  }

  /**
   * Build the prepared document context, deciding whether to use full content or diff.
   */
  private buildDocumentContext(
    rawContext: RawDocumentContext | undefined,
    transitionResult: TransitionResult,
    providerType: AIProviderType
  ): PreparedDocumentContext {
    // Content handling based on transition:
    // - 'none': No content or diff (nothing changed, AI already has context)
    // - 'modified' with claude-code: Use diff instead of full content
    // - 'opened', 'switched': Full content (new file for AI)
    // - 'closed': No content (document closed)

    const transition = transitionResult.transition;

    // Build base context with fields that are always present
    const baseContext: PreparedDocumentContext = {
      filePath: rawContext?.filePath,
      fileType: rawContext?.fileType,
      documentTransition: transition,
    };

    // Add previousFilePath if present
    if (transitionResult.previousFilePath) {
      baseContext.previousFilePath = transitionResult.previousFilePath;
    }

    // Add textSelection if present
    const textSelection = this.normalizeTextSelection(rawContext);
    if (textSelection) {
      baseContext.textSelection = textSelection;
    }

    // For 'none' transition: omit content entirely (nothing changed)
    if (transition === 'none') {
      return baseContext;
    }

    // For Claude Code with 'modified' transition and available diff: use diff, omit content
    const useDiff = providerType === 'claude-code' &&
                    transition === 'modified' &&
                    !!transitionResult.documentDiff;

    if (useDiff) {
      baseContext.documentDiff = transitionResult.documentDiff;
    } else if (rawContext?.content) {
      baseContext.content = rawContext.content;
    }

    return baseContext;
  }

  /**
   * Build user message additions (plan mode instructions, etc.).
   */
  private buildUserMessageAdditions(
    modeTransition?: ModeTransition
  ): UserMessageAdditions {
    const additions: UserMessageAdditions = {};

    if (modeTransition?.enteringPlanMode) {
      additions.planModeInstructions = this.getPlanModeInstructions(modeTransition.planFilePath);
    }

    if (modeTransition?.exitingPlanMode) {
      additions.planModeDeactivation = '<PLAN_MODE_DEACTIVATED>The planning restrictions no longer apply.</PLAN_MODE_DEACTIVATED>';
    }

    return additions;
  }

  /**
   * Get the plan mode instructions to add to the user message.
   *
   * Logic extracted from SessionTranscript.tsx (lines 835-891).
   */
  private getPlanModeInstructions(planFilePath?: string): string {
    return `<NIMBALYST_SYSTEM_MESSAGE>
<PLAN_MODE_ACTIVATED>
You are in PLANNING MODE ONLY.

You MUST NOT:
- Make any code edits (except to the plan file)
- Run any non-readonly tools
- Execute any commands
- Make any changes to the system

You MUST:
- Explore the codebase using Read, Glob, Grep tools
- Ask questions using AskUserQuestion to clarify requirements
- Write and iteratively update a plan file in the plans/ directory
- Call ExitPlanMode when ready for approval

## Plan File

You must create a plan file in the plans/ directory. Choose a descriptive kebab-case name based on the task, for example:
- plans/add-dark-mode.md
- plans/refactor-auth-system.md
- plans/fix-login-timeout-bug.md

The plan file is your working document. Create it early in your planning process and update it iteratively as you learn more.

### Required YAML Frontmatter

Every plan file MUST include YAML frontmatter with metadata for tracking:

\`\`\`yaml
---
planStatus:
  planId: plan-[unique-identifier]
  title: [Plan Title]
  status: draft
  planType: [feature|bug-fix|refactor|system-design|research|initiative|improvement]
  priority: medium
  owner: [username]
  stakeholders: []
  tags: []
  created: "YYYY-MM-DD"
  updated: "YYYY-MM-DDTHH:MM:SS.sssZ"
  progress: 0
---
\`\`\`

## Iterative Planning Workflow

Your goal is to build a comprehensive plan through iterative refinement:

1. Create your plan file in plans/ with a descriptive name
2. Explore the codebase using Read, Glob, and Grep tools
3. Interview the user using AskUserQuestion to clarify requirements
4. Write to the plan file iteratively as you learn more
5. End your turn by either using AskUserQuestion or calling ExitPlanMode when ready
</PLAN_MODE_ACTIVATED>
</NIMBALYST_SYSTEM_MESSAGE>`;
  }

  /**
   * Extract text from the various selection formats.
   * Returns just the selected text string (filePath is always the open document).
   */
  private normalizeTextSelection(rawContext?: RawDocumentContext): TextSelection | undefined {
    if (!rawContext) {
      return undefined;
    }

    // Priority 1: textSelection as string (new simplified format)
    if (typeof rawContext.textSelection === 'string' && rawContext.textSelection) {
      return rawContext.textSelection;
    }

    // Priority 2: textSelection as object (legacy format)
    if (rawContext.textSelection &&
        typeof rawContext.textSelection === 'object' &&
        'text' in rawContext.textSelection) {
      return rawContext.textSelection.text;
    }

    // Priority 3: selection as object with text property
    if (rawContext.selection &&
        typeof rawContext.selection === 'object' &&
        'text' in rawContext.selection &&
        typeof rawContext.selection.text === 'string') {
      return rawContext.selection.text;
    }

    // Priority 4: selection as string (legacy format)
    if (typeof rawContext.selection === 'string') {
      return rawContext.selection;
    }

    // No valid selection found
    return undefined;
  }
}
