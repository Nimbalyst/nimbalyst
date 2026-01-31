---
planStatus:
  planId: plan-refactor-agent-context-service
  title: Refactor Agent Context Service
  status: completed
  planType: refactor
  priority: medium
  owner: jordanbentley
  stakeholders: []
  tags:
    - ai
    - context
    - refactor
    - backend
  created: "2026-01-31"
  updated: "2026-01-31T13:26:00.000Z"
  progress: 100
---
# Refactor Agent Context Service

## Overview

Extract the scattered code for preparing/assembling document context for AI agents (in "files mode") into a single, cohesive service.

## Current State Analysis

### Where Context Logic Lives Today

The context preparation logic is currently spread across **3 main locations**:

#### 1. AIService.ts (Main Process) - ~200 lines
**Location**: `packages/electron/src/main/services/ai/AIService.ts`

**Key responsibilities**:
- `computeDocumentTransition()` (lines 643-725) - Detects document state changes (opened/closed/switched/modified)
- Document state tracking via `lastDocumentStateBySession` Map
- Content hashing for change detection
- Diff computation for modified documents
- Context assembly with session/worktree enrichment (lines 2070-2130)
- Decision logic for content omission (Claude Code optimization)

#### 2. prompt.ts (Runtime) - ~580 lines
**Location**: `packages/runtime/src/ai/prompt.ts`

**Key responsibilities**:
- `buildClaudeCodeSystemPrompt()` - Builds system prompts for Claude Code provider
- `buildSystemPrompt()` - Builds system prompts for other providers (Claude, OpenAI, LM Studio)
- `extractSelectedText()` - Extracts text selection with staleness detection
- `buildSelectedTextSection()` - Formats selection for system prompt
- `buildSessionNamingSection()` - Adds session naming instructions
- Document transition rendering (diff display, "unchanged" messages)

#### 3. types.ts (Runtime) - DocumentContext interface
**Location**: `packages/runtime/src/ai/server/types.ts`

**Key types**:
- `DocumentContext` interface (lines 9-51) - The main context object
- `ChatAttachment` interface (lines 53-62) - Attachment metadata

### Data Flow

```
┌──────────────────────────────────────────────────────────────────┐
│ Renderer (SessionTranscript.tsx)                                  │
│   - Gets fresh document context via getEffectiveDocumentContext() │
│   - Serializes context with serializeDocumentContext()            │
│   - Sends via IPC: ai:sendMessage(message, docContext, ...)       │
└──────────────────────────────┬───────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│ AIService.ts (Main Process)                                       │
│   1. Load session from database                                   │
│   2. Extract attachments                                          │
│   3. computeDocumentTransition() → transition, diff               │
│   4. Update lastDocumentStateBySession                            │
│   5. Assemble contextWithSession with:                            │
│      - Document fields (filePath, fileType, content, selection)   │
│      - Session fields (sessionType, mode, permissionsPath)        │
│      - Worktree fields (worktreeId, worktreePath, etc.)           │
│      - Transition fields (documentTransition, diff)               │
│      - Branch tracking (branchedFromSessionId, etc.)              │
│   6. Pass to provider.sendMessage()                               │
└──────────────────────────────┬───────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│ Provider (e.g., ClaudeCodeProvider, ClaudeProvider)               │
│   - Calls buildClaudeCodeSystemPrompt() or buildSystemPrompt()    │
│   - Passes documentContext, documentTransition, documentDiff      │
│   - prompt.ts formats document content into system prompt         │
└──────────────────────────────────────────────────────────────────┘
```

### Current DocumentContext Interface

```typescript
interface DocumentContext {
  // Core document fields
  filePath?: string;
  fileType?: string;
  content: string;
  cursorPosition?: { line: number; column: number };
  selection?: string | { text, filePath, timestamp } | { start, end };
  textSelection?: { text: string; filePath: string; timestamp: number };
  textSelectionTimestamp?: number | null;

  // Session metadata
  mode?: 'planning' | 'agent';
  sessionType?: SessionType;
  permissionsPath?: string;
  attachments?: ChatAttachment[];

  // Worktree context
  worktreeId?: string;
  worktreePath?: string;
  worktreeProjectPath?: string;

  // Document transition tracking
  documentTransition?: 'none' | 'opened' | 'closed' | 'switched' | 'modified';
  previousFilePath?: string;
  documentDiff?: string;

  // Branch tracking
  branchedFromSessionId?: string;
  branchedFromProviderSessionId?: string;
}
```

## Problems with Current Architecture

1. **Scattered Logic**: Context preparation is split between AIService.ts (state tracking, transition computation) and prompt.ts (formatting for prompts)

2. **Mixed Responsibilities**: AIService.ts does both orchestration AND context manipulation

3. **No Clear Interface**: The "service" for context preparation doesn't exist - it's just inline code

4. **Difficult to Test**: State management mixed with IPC handling makes unit testing hard

5. **Provider-Specific Logic Leaking**: shouldOmitContent logic is in AIService.ts but is provider-specific

## Proposed Service Design

### Design Decisions

- **Scope**: All providers (Claude, Claude Code, OpenAI, OpenAI Codex, LM Studio)
- **Location**: `packages/runtime/src/ai/services/` (shared across packages)
- **Focus**: Context preparation only (prompt building remains separate in prompt.ts)
- **State**: Service owns `lastDocumentStateBySession` Map (stateful)

## Service Interface

### Input Types

```typescript
/**
 * Raw document context from the renderer process.
 * This is what comes over IPC from SessionTranscript.tsx.
 */
interface RawDocumentContext {
  // Core document fields
  filePath?: string;
  fileType?: string;
  content: string;  // Full content always sent from renderer

  // Selection (multiple legacy formats supported - will be normalized)
  selection?: string | { text: string; filePath: string; timestamp: number } | { start: { line: number; column: number }; end: { line: number; column: number } };
  textSelection?: { text: string; filePath: string; timestamp: number };
  textSelectionTimestamp?: number | null;
}
```

Note: Session metadata (worktree context, branch tracking, permissionsPath, attachments) stays in AIService.ts. This service only handles document content and transition tracking.

### Output Types

```typescript
/**
 * Document transition types - describes what changed since last message.
 */
type DocumentTransition = 'none' | 'opened' | 'closed' | 'switched' | 'modified';

/**
 * Minimal prepared context focused on document state.
 * Session/worktree metadata stays in AIService - this service only handles document context.
 */
interface PreparedDocumentContext {
  // Core document identity
  filePath?: string;
  fileType?: string;

  // Content (mutually exclusive based on transition)
  content?: string;       // Full content (for 'opened', 'switched', or when no diff available)
  documentDiff?: string;  // Unified diff (for 'modified' when diff is smaller than content)

  // Document transition
  documentTransition: DocumentTransition;

  // Selection (normalized)
  textSelection?: { text: string; filePath: string; timestamp: number };
}

/**
 * Prompt additions to append to the user message.
 * These are the <NIMBALYST_SYSTEM_MESSAGE> blocks.
 */
interface UserMessageAdditions {
  /** Plan mode instructions (when entering planning mode) */
  planModeInstructions?: string;

  /** Plan mode deactivation notice (when exiting planning mode) */
  planModeDeactivation?: string;
}

/**
 * Complete result from context preparation.
 */
interface ContextPreparationResult {
  /** Prepared document context for the provider */
  documentContext: PreparedDocumentContext;

  /** Additions to append to the user's message */
  userMessageAdditions: UserMessageAdditions;
}
```

### Service Interface

```typescript
/**
 * Service for preparing document context and user message additions for AI providers.
 *
 * Responsibilities:
 * - Track document state per session (content hashing)
 * - Compute document transitions (opened/closed/switched/modified)
 * - Generate unified diffs for modified documents
 * - Decide whether to send full content or diff
 * - Build user message additions (plan mode instructions)
 *
 * NOT responsible for:
 * - System prompt building (remains in prompt.ts)
 * - Attachment file reading (handled by providers)
 * - IPC handling (remains in AIService.ts)
 * - Session/worktree metadata enrichment (remains in AIService.ts)
 */
interface IDocumentContextService {
  /**
   * Prepare document context and user message additions for an AI provider.
   *
   * @param rawContext - Document context from renderer (may be undefined if no document open)
   * @param sessionId - Session ID for state tracking
   * @param providerType - Type of AI provider (affects content/diff decision)
   * @param modeTransition - Information about mode changes for building user message additions
   * @returns Prepared context and any user message additions
   */
  prepareContext(
    rawContext: RawDocumentContext | undefined,
    sessionId: string,
    providerType: AIProviderType,
    modeTransition?: {
      enteringPlanMode?: boolean;
      exitingPlanMode?: boolean;
      planFilePath?: string;  // For plan mode instructions
    }
  ): ContextPreparationResult;

  /**
   * Clear cached document state for a session.
   * Call when session ends or user explicitly closes document.
   */
  clearSessionState(sessionId: string): void;

  /**
   * Get the last known document state for a session (for debugging/testing).
   */
  getSessionState(sessionId: string): DocumentState | undefined;
}

/**
 * Internal state tracked per session for transition detection.
 */
interface DocumentState {
  filePath: string;
  content: string;
  contentHash: string;
}
```

### Class Implementation Skeleton

```typescript
// Location: packages/runtime/src/ai/services/DocumentContextService.ts

import { hashContent, computeDiff } from '../utils/documentDiff';
import type { AIProviderType } from '../server/types';

export class DocumentContextService implements IDocumentContextService {
  /** Per-session document state for transition detection */
  private lastDocumentStateBySession: Map<string, DocumentState> = new Map();

  prepareContext(
    rawContext: RawDocumentContext | undefined,
    sessionId: string,
    providerType: AIProviderType,
    modeTransition?: {
      enteringPlanMode?: boolean;
      exitingPlanMode?: boolean;
      planFilePath?: string;
    }
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

  private computeTransition(
    rawContext: RawDocumentContext | undefined,
    sessionId: string
  ): TransitionResult {
    // Logic extracted from AIService.computeDocumentTransition (lines 643-725)
    // Returns: { transition, newState, documentDiff }
  }

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
      textSelection: this.normalizeTextSelection(rawContext),
    };
  }

  private buildUserMessageAdditions(
    modeTransition?: {
      enteringPlanMode?: boolean;
      exitingPlanMode?: boolean;
      planFilePath?: string;
    }
  ): UserMessageAdditions {
    const additions: UserMessageAdditions = {};

    if (modeTransition?.enteringPlanMode) {
      // Plan mode instructions (currently in SessionTranscript.tsx lines 835-891)
      additions.planModeInstructions = this.getPlanModeInstructions(modeTransition.planFilePath);
    }

    if (modeTransition?.exitingPlanMode) {
      additions.planModeDeactivation = '<PLAN_MODE_DEACTIVATED>The planning restrictions no longer apply.</PLAN_MODE_DEACTIVATED>';
    }

    return additions;
  }

  private getPlanModeInstructions(planFilePath?: string): string {
    // Return the full plan mode instructions block
    // Currently hardcoded in SessionTranscript.tsx
  }

  private normalizeTextSelection(rawContext?: RawDocumentContext): TextSelection | undefined {
    // Normalize the various selection formats to a single format
  }
}
```

## Implementation Plan

### Phase 1: Create the Service (No Breaking Changes)

1. **Create new file**: `packages/runtime/src/ai/services/DocumentContextService.ts`
   - Implement `DocumentContextService` class
   - Extract `computeDocumentTransition` logic from AIService.ts (lines 643-725)
   - Extract content/diff decision logic from AIService.ts (lines 2073-2076)
   - Move plan mode instructions from SessionTranscript.tsx (lines 835-891)
   - Add unit tests

2. **Create types file**: `packages/runtime/src/ai/services/types.ts`
   - Define `RawDocumentContext` (simplified input)
   - Define `PreparedDocumentContext` (minimal output)
   - Define `UserMessageAdditions` (plan mode, etc.)
   - Define `ContextPreparationResult`
   - Define `IDocumentContextService` interface
   - Export from `packages/runtime/src/ai/index.ts`

3. **Move utility functions**: Ensure `hashContent` and `computeDiff` are accessible
   - Currently in `packages/runtime/src/utils/documentDiff.ts`
   - No changes needed, just import into new service

### Phase 2: Integrate with Backend

4. **Update AIService.ts**:
   - Import and instantiate `DocumentContextService`
   - Replace inline `computeDocumentTransition` with service call
   - Use `PreparedDocumentContext` from service, then merge with session metadata
   - Remove `lastDocumentStateBySession` Map (now owned by service)
   - Remove `computeDocumentTransition` method

### Phase 3: Integrate with Frontend

5. **Update SessionTranscript.tsx**:
   - Remove hardcoded plan mode instructions (lines 835-891)
   - Pass mode transition info via IPC for service to build additions
   - OR: Keep in renderer and just format in service (TBD)

## Files to Modify

| File | Action | Changes |
| --- | --- | --- |
| `packages/runtime/src/ai/services/DocumentContextService.ts` | **Create** | New service class |
| `packages/runtime/src/ai/services/types.ts` | **Create** | New type definitions |
| `packages/runtime/src/ai/services/index.ts` | **Create** | Re-exports |
| `packages/runtime/src/ai/index.ts` | **Modify** | Add exports for new service |
| `packages/electron/src/main/services/ai/AIService.ts` | **Modify** | Use service, remove ~80 lines |
| `packages/electron/src/renderer/.../SessionTranscript.tsx` | **Modify** | Remove plan mode instructions (~60 lines) |
| `packages/runtime/src/ai/server/types.ts` | **No change** | Existing DocumentContext interface unchanged |

## Testing Strategy

1. **Unit tests for DocumentContextService**:
   - Test each transition type (none, opened, closed, switched, modified)
   - Test diff generation and content/diff decision
   - Test text selection normalization
   - Test plan mode instruction building
   - Test session state caching and clearing

2. **Integration tests**:
   - Verify AIService correctly uses the service
   - Verify plan mode instructions appear correctly in messages

## Benefits After Refactor

1. **Single Responsibility**: Document context + user message additions in one place
2. **Testable**: Service can be unit tested in isolation
3. **Simpler Types**: `PreparedDocumentContext` has only 6 fields vs 20+ in current DocumentContext
4. **Maintainable**: Plan mode instructions centralized instead of hardcoded in renderer
5. **Type Safety**: Clear input/output contracts with dedicated types

## Migration Risk Assessment

**Low Risk**:
- No changes to IPC interface (renderer still sends same data)
- No changes to provider interface (providers still receive DocumentContext)
- Pure extraction/encapsulation refactor
- Can be done incrementally (service can be created without changing AIService initially)

## Implementation Summary

### Completed Work

The refactoring has been successfully completed with the following changes:

#### 1. New Service Files Created
- `packages/runtime/src/ai/services/types.ts` - Type definitions for the service
- `packages/runtime/src/ai/services/DocumentContextService.ts` - Main service implementation
- `packages/runtime/src/ai/services/index.ts` - Re-exports
- `packages/runtime/src/ai/services/__tests__/DocumentContextService.test.ts` - Comprehensive unit tests (19 tests, all passing)

#### 2. AIService.ts Changes
- Added `DocumentContextService` instance to the class
- Replaced inline `computeDocumentTransition` call with `documentContextService.prepareContext()`
- Removed `computeDocumentTransition` method (~80 lines)
- Removed `lastDocumentStateBySession` Map (now owned by service)
- Updated session deletion to call `documentContextService.clearSessionState()`
- Removed unused imports (`hashContent`, `computeDiff`, `DocumentState`)

#### 3. Export Updates
- Added selective exports to `packages/runtime/src/index.ts` to avoid type conflicts with existing `DocumentState` and `DocumentTransition` exports from `utils/documentDiff`

#### 4. Code Reduction
- **AIService.ts**: ~80 lines removed (computeDocumentTransition method)
- **Net effect**: Better separation of concerns with service owning all document context logic

#### 5. Test Coverage
All service functionality is covered by unit tests:
- Document transition detection (opened, closed, switched, modified, none)
- Content vs diff decision logic for different providers
- Text selection normalization (3 different legacy formats)
- User message additions (plan mode instructions)
- Session state management and isolation

### Plan Mode Instructions
Plan mode instructions remain in SessionTranscript.tsx for now. The service has the capability to build these additions via the `buildUserMessageAdditions` method, but we're keeping the current approach where the renderer appends them to the message. This can be migrated in the future by passing mode transition info via IPC.

### Benefits Achieved
1. **Single Responsibility**: All document context preparation logic is now in one service
2. **Testable**: 19 unit tests covering all scenarios
3. **Type Safety**: Clear input/output contracts with dedicated types
4. **Maintainable**: Service can be enhanced independently of AIService
5. **No Breaking Changes**: IPC interface unchanged, providers still receive DocumentContext

### TypeScript Compilation
- Runtime package: ✅ No errors related to the refactoring
- Electron package: ✅ No errors related to the refactoring
- All tests: ✅ Passing (19/19)
