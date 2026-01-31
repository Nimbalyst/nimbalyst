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
} from './types';

export class DocumentContextService implements IDocumentContextService {
  /** Per-session document state for transition detection */
  private lastDocumentStateBySession: Map<string, DocumentState> = new Map();

  prepareContext(
    rawContext: RawDocumentContext | undefined,
    sessionId: string,
    providerType: AIProviderType,
    modeTransition?: ModeTransition
  ): ContextPreparationResult {
    // 1. Compute document transition
    const transitionResult = this.computeTransition(rawContext, sessionId);

    // 2. Update cached state
    if (transitionResult.newState) {
      this.lastDocumentStateBySession.set(sessionId, transitionResult.newState);
    } else if (transitionResult.transition === 'closed') {
      this.lastDocumentStateBySession.delete(sessionId);
    }

    // 3. Build document context (decide content vs diff)
    const documentContext = this.buildDocumentContext(
      rawContext,
      transitionResult,
      providerType
    );

    // 4. Build user message additions
    const userMessageAdditions = this.buildUserMessageAdditions(modeTransition);

    return { documentContext, userMessageAdditions };
  }

  clearSessionState(sessionId: string): void {
    this.lastDocumentStateBySession.delete(sessionId);
  }

  getSessionState(sessionId: string): DocumentState | undefined {
    return this.lastDocumentStateBySession.get(sessionId);
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
    // For Claude Code with 'modified' transition and available diff: use diff, omit content
    // For all other cases: use full content
    const useDiff = providerType === 'claude-code' &&
                    transitionResult.transition === 'modified' &&
                    !!transitionResult.documentDiff;

    return {
      filePath: rawContext?.filePath,
      fileType: rawContext?.fileType,
      content: useDiff ? undefined : rawContext?.content,
      documentDiff: useDiff ? transitionResult.documentDiff : undefined,
      documentTransition: transitionResult.transition,
      previousFilePath: transitionResult.previousFilePath,
      textSelection: this.normalizeTextSelection(rawContext),
    };
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
   * Normalize the various selection formats to a single TextSelection format.
   */
  private normalizeTextSelection(rawContext?: RawDocumentContext): TextSelection | undefined {
    if (!rawContext) {
      return undefined;
    }

    // Priority 1: textSelection object (newest format)
    if (rawContext.textSelection &&
        typeof rawContext.textSelection === 'object' &&
        'text' in rawContext.textSelection) {
      return rawContext.textSelection as TextSelection;
    }

    // Priority 2: selection as object with text/filePath/timestamp
    if (rawContext.selection &&
        typeof rawContext.selection === 'object' &&
        'text' in rawContext.selection &&
        typeof rawContext.selection.text === 'string') {
      const sel = rawContext.selection as { text: string; filePath: string; timestamp: number };
      return {
        text: sel.text,
        filePath: sel.filePath,
        timestamp: sel.timestamp,
      };
    }

    // Priority 3: selection as string (legacy format - just text)
    if (typeof rawContext.selection === 'string' && rawContext.filePath) {
      return {
        text: rawContext.selection,
        filePath: rawContext.filePath,
        timestamp: rawContext.textSelectionTimestamp || Date.now(),
      };
    }

    // No valid selection found
    return undefined;
  }
}
