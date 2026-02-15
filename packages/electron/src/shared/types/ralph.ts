/**
 * Ralph Loop Types
 *
 * Ralph Loops are an autonomous AI agent loop pattern that runs iteratively until a task is complete.
 * Each iteration starts with fresh context while state persists via files (progress tracking, git history).
 */

/**
 * Status of a Ralph Loop
 */
export type RalphLoopStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'blocked';

/**
 * Status of a single Ralph iteration
 */
export type RalphIterationStatus = 'running' | 'completed' | 'failed';

/**
 * Exit condition types for why a Ralph Loop ended
 */
export type RalphExitConditionType =
  | 'completed' // Task marked as complete
  | 'max_iterations' // Reached maximum iteration limit
  | 'blocked' // Claude indicated it's stuck
  | 'user_stopped' // User manually stopped
  | 'error'; // Unrecoverable error

/**
 * Ralph Loop configuration and state (database model)
 */
export interface RalphLoop {
  id: string; // ULID
  worktreeId: string;
  taskDescription: string;
  title?: string; // User-editable display name (falls back to first line of taskDescription)
  status: RalphLoopStatus;
  currentIteration: number;
  maxIterations: number;
  modelId?: string; // Full provider:model ID (e.g. "claude-code:opus")
  completionReason?: string;
  isArchived?: boolean;
  isPinned?: boolean;
  createdAt: number; // Milliseconds timestamp
  updatedAt: number;
}

/**
 * Ralph iteration record (database model)
 * Each iteration is linked to an AI session
 */
export interface RalphIteration {
  id: string; // ULID
  ralphLoopId: string;
  sessionId: string;
  iterationNumber: number;
  status: RalphIterationStatus;
  exitReason?: string;
  createdAt: number; // Milliseconds timestamp
  completedAt?: number;
}

/**
 * Ralph Loop with all its iterations
 */
export interface RalphLoopWithIterations extends RalphLoop {
  iterations: RalphIteration[];
}

/**
 * Configuration for creating a new Ralph Loop
 */
export interface RalphLoopConfig {
  maxIterations?: number;
  modelId?: string; // Full provider:model ID (e.g. "claude-code:opus")
}

/**
 * Exit condition detected during Ralph Loop execution
 */
export interface RalphExitCondition {
  type: RalphExitConditionType;
  reason: string;
}

/**
 * Phase of the Ralph Loop
 * - planning: Claude analyzes requirements and creates IMPLEMENTATION_PLAN.md
 * - building: Claude implements one item from the plan per iteration
 */
export type RalphPhase = 'planning' | 'building';

/**
 * Progress file structure (.ralph/progress.json)
 * This file is read/written by Claude at each iteration to track state
 */
export interface RalphProgressFile {
  currentIteration: number;
  phase: RalphPhase;
  status: 'running' | 'completed' | 'blocked';
  completionSignal: boolean;
  learnings: RalphLearning[];
  blockers: string[];
  userFeedback?: string; // User-provided context when continuing a blocked loop
}

/**
 * Learning captured from a single iteration
 */
export interface RalphLearning {
  iteration: number;
  summary: string;
  filesChanged: string[];
}

/**
 * Events emitted during Ralph Loop execution
 */
export type RalphLoopEvent =
  | { type: 'iteration-started'; ralphId: string; iterationId: string; iterationNumber: number; sessionId: string }
  | { type: 'iteration-completed'; ralphId: string; iterationId: string; iterationNumber: number; exitReason?: string }
  | { type: 'iteration-failed'; ralphId: string; iterationId: string; iterationNumber: number; error: string }
  | { type: 'loop-completed'; ralphId: string; reason: string }
  | { type: 'loop-blocked'; ralphId: string; reason: string }
  | { type: 'loop-paused'; ralphId: string }
  | { type: 'loop-resumed'; ralphId: string }
  | { type: 'loop-stopped'; ralphId: string; reason: string }
  | { type: 'loop-failed'; ralphId: string; error: string };

/**
 * Default configuration values
 */
export const RALPH_DEFAULTS = {
  maxIterations: 20,
} as const;
