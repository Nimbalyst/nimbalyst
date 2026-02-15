/**
 * RalphLoopService - Core orchestration for Ralph Loops
 *
 * Ralph Loops are an autonomous AI agent loop pattern that runs iteratively until a task is complete.
 * Each iteration starts with fresh context while state persists via files (progress tracking, git history).
 */

import { app, BrowserWindow } from 'electron';
import log from 'electron-log/main';
import { ulid } from 'ulid';
import * as fs from 'fs';
import * as path from 'path';
import { getDatabase } from '../database/initialize';
import { createRalphLoopStore, type RalphLoopStore } from './RalphLoopStore';
import { createWorktreeStore, type WorktreeStore } from './WorktreeStore';
import { AISessionsRepository } from '@nimbalyst/runtime/storage/repositories/AISessionsRepository';
import { AgentMessagesRepository } from '@nimbalyst/runtime/storage/repositories/AgentMessagesRepository';
import {
  RALPH_DEFAULTS,
  type RalphLoop,
  type RalphLoopWithIterations,
  type RalphLoopConfig,
  type RalphExitCondition,
  type RalphProgressFile,
  type RalphLoopEvent,
  type RalphPhase,
} from '../../shared/types/ralph';

const logger = log.scope('RalphLoopService');

const MAX_CONSECUTIVE_FAILURES = 3;

/**
 * Ralph Loop runner state
 */
interface RalphLoopRunnerState {
  loop: RalphLoop;
  worktreePath: string;
  workspaceId: string;
  isPaused: boolean;
  isStopped: boolean;
  currentSessionId: string | null;
  currentIterationId: string | null;
}

/**
 * RalphLoopService - Singleton service for managing Ralph Loops
 */
export class RalphLoopService {
  private static instance: RalphLoopService | null = null;
  private activeRunners: Map<string, RalphLoopRunnerState> = new Map();
  private ralphStore: RalphLoopStore | null = null;
  private worktreeStore: WorktreeStore | null = null;

  private constructor() {}

  public static getInstance(): RalphLoopService {
    if (!RalphLoopService.instance) {
      RalphLoopService.instance = new RalphLoopService();
    }
    return RalphLoopService.instance;
  }

  /**
   * Initialize stores lazily
   */
  private async ensureStores(): Promise<{ ralphStore: RalphLoopStore; worktreeStore: WorktreeStore }> {
    const db = getDatabase();
    if (!db) {
      throw new Error('Database not initialized');
    }

    if (!this.ralphStore) {
      this.ralphStore = createRalphLoopStore(db);
    }
    if (!this.worktreeStore) {
      this.worktreeStore = createWorktreeStore(db);
    }

    return { ralphStore: this.ralphStore, worktreeStore: this.worktreeStore };
  }

  /**
   * Recover ralph loops that were interrupted by app restart.
   * Called once at startup after handlers are registered.
   * Running loops -> paused, orphaned running iterations -> failed.
   */
  async recoverStaleLoopState(): Promise<void> {
    try {
      const { ralphStore } = await this.ensureStores();
      const activeLoops = await ralphStore.getActiveLoops();

      if (activeLoops.length === 0) {
        return;
      }

      logger.info('Recovering stale ralph loops', { count: activeLoops.length });

      for (const loop of activeLoops) {
        if (loop.status === 'running') {
          await ralphStore.updateLoopStatus(loop.id, 'paused', 'Interrupted by app restart');
          logger.info('Recovered stale running loop -> paused', { id: loop.id });
        }
        await ralphStore.failOrphanedIterations(loop.id);
      }

      logger.info('Stale ralph loop recovery complete');
    } catch (error) {
      logger.error('Failed to recover stale ralph loop state', { error });
    }
  }

  // ========================================
  // Ralph Loop Lifecycle
  // ========================================

  /**
   * Create a new Ralph Loop for a worktree
   */
  async createLoop(
    worktreeId: string,
    taskDescription: string,
    config?: RalphLoopConfig
  ): Promise<RalphLoop> {
    logger.info('Creating ralph loop', { worktreeId, taskDescription: taskDescription.slice(0, 100) });

    const { ralphStore, worktreeStore } = await this.ensureStores();

    // Verify worktree exists
    const worktree = await worktreeStore.get(worktreeId);
    if (!worktree) {
      throw new Error(`Worktree not found: ${worktreeId}`);
    }

    // Check if there's already an active loop for this worktree
    const existingLoop = await ralphStore.getLoopByWorktreeId(worktreeId);
    if (existingLoop && (existingLoop.status === 'running' || existingLoop.status === 'paused')) {
      throw new Error(`Worktree already has an active Ralph Loop: ${existingLoop.id}`);
    }

    const loopId = ulid();
    const maxIterations = config?.maxIterations ?? RALPH_DEFAULTS.maxIterations;
    const modelId = config?.modelId;

    const loop = await ralphStore.createLoop(loopId, worktreeId, taskDescription, maxIterations, modelId);

    // Initialize ralph files in the worktree
    await this.initializeRalphFiles(worktree.path, taskDescription, maxIterations);

    logger.info('Ralph loop created', { id: loop.id, worktreeId, modelId });

    return loop;
  }

  /**
   * Start or resume a Ralph Loop
   */
  async startLoop(ralphId: string): Promise<void> {
    logger.info('Starting ralph loop', { ralphId });

    const { ralphStore, worktreeStore } = await this.ensureStores();

    const loop = await ralphStore.getLoop(ralphId);
    if (!loop) {
      throw new Error(`Ralph loop not found: ${ralphId}`);
    }

    if (loop.status === 'completed' || loop.status === 'failed') {
      throw new Error(`Cannot start a ${loop.status} ralph loop`);
    }

    // Check if already running
    if (this.activeRunners.has(ralphId)) {
      const runner = this.activeRunners.get(ralphId)!;
      if (runner.isPaused) {
        runner.isPaused = false;
        this.signalResume(ralphId);
        this.emitEvent({ type: 'loop-resumed', ralphId });
        return;
      }
      throw new Error('Ralph loop is already running');
    }

    // Get worktree info
    const worktree = await worktreeStore.get(loop.worktreeId);
    if (!worktree) {
      throw new Error(`Worktree not found: ${loop.worktreeId}`);
    }

    // Update status to running
    await ralphStore.updateLoopStatus(ralphId, 'running');

    // Create runner state
    const runnerState: RalphLoopRunnerState = {
      loop: { ...loop, status: 'running' },
      worktreePath: worktree.path,
      workspaceId: worktree.projectPath,
      isPaused: false,
      isStopped: false,
      currentSessionId: null,
      currentIterationId: null,
    };
    this.activeRunners.set(ralphId, runnerState);

    // Start the loop asynchronously
    this.runLoop(ralphId).catch(error => {
      logger.error('Ralph loop failed', { ralphId, error });
      this.handleLoopError(ralphId, error);
    });
  }

  /**
   * Pause a running Ralph Loop
   */
  async pauseLoop(ralphId: string): Promise<void> {
    logger.info('Pausing ralph loop', { ralphId });

    const runner = this.activeRunners.get(ralphId);
    if (!runner) {
      throw new Error('Ralph loop is not running');
    }

    runner.isPaused = true;
    const { ralphStore } = await this.ensureStores();
    await ralphStore.updateLoopStatus(ralphId, 'paused');

    this.emitEvent({ type: 'loop-paused', ralphId });
  }

  /**
   * Stop a Ralph Loop
   */
  async stopLoop(ralphId: string, reason: string = 'User stopped'): Promise<void> {
    logger.info('Stopping ralph loop', { ralphId, reason });

    const runner = this.activeRunners.get(ralphId);
    if (runner) {
      runner.isStopped = true;
      runner.isPaused = false;

      // Resolve pending session resolver so runLoop can exit cleanly
      if (runner.currentSessionId) {
        const sessionResolver = sessionCompleteResolvers.get(runner.currentSessionId);
        if (sessionResolver) {
          sessionCompleteResolvers.delete(runner.currentSessionId);
          sessionResolver({ success: false });
        }
      }

      // Resolve pending pause resolver so runLoop can exit cleanly
      const pauseResolver = pauseResolvers.get(ralphId);
      if (pauseResolver) {
        pauseResolvers.delete(ralphId);
        pauseResolver();
      }
    }

    const { ralphStore } = await this.ensureStores();
    await ralphStore.updateLoopStatus(ralphId, 'completed', reason);

    this.activeRunners.delete(ralphId);
    this.emitEvent({ type: 'loop-stopped', ralphId, reason });
  }

  /**
   * Continue a blocked Ralph Loop with user-provided feedback
   */
  async continueBlockedLoop(ralphId: string, userFeedback: string): Promise<void> {
    logger.info('Continuing blocked ralph loop', { ralphId });

    const { ralphStore, worktreeStore } = await this.ensureStores();

    const loop = await ralphStore.getLoop(ralphId);
    if (!loop) {
      throw new Error(`Ralph loop not found: ${ralphId}`);
    }

    // Only allow continuing blocked loops
    if (loop.status !== 'blocked') {
      throw new Error(`Cannot continue a ${loop.status} ralph loop - only blocked loops can be continued`);
    }

    // Get worktree to read/write progress file
    const worktree = await worktreeStore.get(loop.worktreeId);
    if (!worktree) {
      throw new Error(`Worktree not found: ${loop.worktreeId}`);
    }

    // Read current progress
    const progress = await this.readProgressFile(worktree.path);
    if (!progress || progress.status !== 'blocked') {
      throw new Error('Loop is not in blocked state');
    }

    // Update progress.json with user feedback and reset status
    const updatedProgress: RalphProgressFile = {
      ...progress,
      status: 'running',
      blockers: [], // Clear blockers
      userFeedback: userFeedback.trim(),
    };

    await this.writeProgressFile(worktree.path, updatedProgress);

    // Reset loop status to pending so startLoop can run
    await ralphStore.updateLoopStatus(ralphId, 'pending');

    // Start the loop
    await this.startLoop(ralphId);
  }

  /**
   * Force-resume a completed/failed/blocked loop
   */
  async forceResumeLoop(
    ralphId: string,
    options?: { bumpMaxIterations?: number; resetCompletionSignal?: boolean }
  ): Promise<void> {
    logger.info('Force-resuming ralph loop', { ralphId, options });

    const { ralphStore, worktreeStore } = await this.ensureStores();

    const loop = await ralphStore.getLoop(ralphId);
    if (!loop) {
      throw new Error(`Ralph loop not found: ${ralphId}`);
    }

    if (loop.status === 'running') {
      throw new Error('Loop is already running');
    }

    const worktree = await worktreeStore.get(loop.worktreeId);
    if (!worktree) {
      throw new Error(`Worktree not found: ${loop.worktreeId}`);
    }

    if (options?.bumpMaxIterations && options.bumpMaxIterations > 0) {
      await ralphStore.updateMaxIterations(ralphId, loop.maxIterations + options.bumpMaxIterations);
    }

    if (options?.resetCompletionSignal) {
      const progress = await this.readProgressFile(worktree.path);
      if (progress && progress.completionSignal) {
        await this.writeProgressFile(worktree.path, {
          ...progress,
          completionSignal: false,
          status: 'running',
        });
      }
    }

    await ralphStore.updateLoopStatus(ralphId, 'pending');
    await this.startLoop(ralphId);
  }

  // ========================================
  // Loop Execution
  // ========================================

  /**
   * Main loop execution
   */
  private async runLoop(ralphId: string): Promise<void> {
    logger.info('Running ralph loop', { ralphId });

    const { ralphStore } = await this.ensureStores();
    let consecutiveFailures = 0;

    while (true) {
      const runner = this.activeRunners.get(ralphId);
      if (!runner || runner.isStopped) {
        logger.info('Ralph loop exiting: runner stopped or missing', { ralphId, hasRunner: !!runner });
        return;
      }

      // Wait if paused using event-driven approach
      if (runner.isPaused) {
        await this.waitForResume(ralphId);
      }

      if (runner.isStopped) {
        logger.info('Ralph loop exiting: stopped after resume', { ralphId });
        return;
      }

      // Refresh loop state
      const loop = await ralphStore.getLoop(ralphId);
      if (!loop) {
        throw new Error('Ralph loop disappeared');
      }

      // Check max iterations
      if (loop.currentIteration >= loop.maxIterations) {
        logger.info('Ralph loop exiting: max iterations reached', {
          ralphId,
          currentIteration: loop.currentIteration,
          maxIterations: loop.maxIterations,
        });
        await this.completeLoop(ralphId, 'max_iterations', `Reached maximum iterations: ${loop.maxIterations}`);
        return;
      }

      // Check exit conditions from progress file
      const exitCondition = await this.checkExitConditions(runner.worktreePath);
      if (exitCondition) {
        logger.info('Ralph loop exiting: exit condition from progress file', {
          ralphId,
          exitType: exitCondition.type,
          exitReason: exitCondition.reason,
          currentIteration: loop.currentIteration,
        });
        if (exitCondition.type === 'blocked') {
          await this.blockLoop(ralphId, exitCondition.reason);
        } else {
          await this.completeLoop(ralphId, exitCondition.type, exitCondition.reason);
        }
        return;
      }

      // Run next iteration
      try {
        logger.info('Ralph loop starting iteration', {
          ralphId,
          nextIteration: loop.currentIteration + 1,
          consecutiveFailures,
        });
        await this.runIteration(ralphId, runner);
        // Reset consecutive failures on success
        consecutiveFailures = 0;
        logger.info('Ralph loop iteration completed successfully', {
          ralphId,
          iteration: loop.currentIteration + 1,
        });
      } catch (error) {
        consecutiveFailures++;
        logger.error('Iteration failed', {
          ralphId,
          iteration: loop.currentIteration + 1,
          consecutiveFailures,
          error: error instanceof Error ? error.message : String(error),
        });

        // Mark iteration as failed
        if (runner.currentIterationId) {
          await ralphStore.updateIterationStatus(runner.currentIterationId, 'failed',
            error instanceof Error ? error.message : 'Unknown error');
        }

        // Check if we've hit max consecutive failures
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          logger.info('Ralph loop exiting: max consecutive failures', {
            ralphId,
            consecutiveFailures,
          });
          await this.completeLoop(
            ralphId,
            'error',
            `Stopped after ${MAX_CONSECUTIVE_FAILURES} consecutive iteration failures`
          );
          return;
        }

        // Exponential backoff before retry (5s, 10s, 20s)
        const delayMs = 5000 * Math.pow(2, consecutiveFailures - 1);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }

  /**
   * Wait for a paused loop to be resumed or stopped
   */
  private waitForResume(ralphId: string): Promise<void> {
    return new Promise((resolve) => {
      pauseResolvers.set(ralphId, resolve);
    });
  }

  /**
   * Signal that a loop has been resumed
   */
  private signalResume(ralphId: string): void {
    const resolver = pauseResolvers.get(ralphId);
    if (resolver) {
      pauseResolvers.delete(ralphId);
      resolver();
    }
  }

  /**
   * Run a single iteration
   */
  private async runIteration(ralphId: string, runner: RalphLoopRunnerState): Promise<void> {
    const { ralphStore } = await this.ensureStores();

    // Read current phase from progress file
    const progress = await this.readProgressFile(runner.worktreePath);
    const phase: RalphPhase = progress?.phase ?? 'planning';

    // Increment iteration counter
    const iterationNumber = await ralphStore.incrementIteration(ralphId);
    runner.loop.currentIteration = iterationNumber;

    logger.info('Starting ralph iteration', { ralphId, iterationNumber, phase });

    // Create a new AI session for this iteration
    const sessionId = ulid();
    const iterationId = ulid();

    runner.currentSessionId = sessionId;
    runner.currentIterationId = iterationId;

    // Create the session in the database
    const phaseLabel = phase === 'planning' ? 'Plan' : 'Build';
    const model = runner.loop.modelId || 'claude-code:opus';
    // Extract provider from model ID (format is "provider:model")
    const provider = model.includes(':') ? model.split(':')[0] : 'claude-code';
    await AISessionsRepository.create({
      id: sessionId,
      provider,
      model,
      title: `Ralph ${phaseLabel} #${iterationNumber}`,
      workspaceId: runner.workspaceId,
      providerConfig: {
        workingDirectory: runner.worktreePath,
      },
      worktreeId: runner.loop.worktreeId,
    });

    // Create iteration record
    await ralphStore.createIteration(iterationId, ralphId, sessionId, iterationNumber);

    this.emitEvent({
      type: 'iteration-started',
      ralphId,
      iterationId,
      iterationNumber,
      sessionId
    });

    // Generate the ralph prompt based on current phase
    const prompt = this.generateRalphPrompt(phase);

    // Send the prompt to Claude Code
    // This needs to be done via the renderer process which handles the AI communication
    // We'll emit an event that the renderer can listen to and process
    this.emitIterationPrompt(ralphId, sessionId, prompt, runner.worktreePath, runner.workspaceId);

    // Inject progress snapshot at START of iteration (after prompt is emitted so the
    // snapshot messages don't exist when the renderer loads the session for ai:sendMessage)
    await this.injectProgressSnapshot(sessionId, runner.worktreePath, 'iteration-start', iterationNumber, ralphId);

    // Wait for the session to complete
    // The renderer will call back when the session is done
    const result = await this.waitForSessionComplete(sessionId);

    if (result.success) {
      // Inject progress snapshot at END of iteration
      await this.injectProgressSnapshot(sessionId, runner.worktreePath, 'iteration-end', iterationNumber, ralphId);

      // Mark iteration as completed
      await ralphStore.updateIterationStatus(iterationId, 'completed');

      this.emitEvent({
        type: 'iteration-completed',
        ralphId,
        iterationId,
        iterationNumber
      });
    } else {
      // Session was interrupted (window closed, user stopped, etc.)
      await ralphStore.updateIterationStatus(iterationId, 'failed', 'Session interrupted');

      this.emitEvent({
        type: 'iteration-failed',
        ralphId,
        iterationId,
        iterationNumber,
        error: 'Session interrupted'
      });

      throw new Error('Session interrupted');
    }
  }

  /**
   * Wait for a session to complete
   * No timeout - iterations can run as long as needed
   */
  private waitForSessionComplete(sessionId: string): Promise<{ success: boolean }> {
    logger.info('Waiting for session complete', {
      sessionId,
      pendingResolvers: sessionCompleteResolvers.size,
    });
    return new Promise((resolve) => {
      sessionCompleteResolvers.set(sessionId, (result: { success: boolean }) => {
        logger.info('Session complete resolver called', { sessionId, success: result.success });
        resolve(result);
      });
    });
  }

  /**
   * Called when a session completes (from renderer)
   */
  notifySessionComplete(sessionId: string, success: boolean = true): void {
    const resolver = sessionCompleteResolvers.get(sessionId);
    if (resolver) {
      logger.info('Resolving session complete', {
        sessionId,
        success,
        remainingResolvers: sessionCompleteResolvers.size - 1,
      });
      sessionCompleteResolvers.delete(sessionId);
      resolver({ success });
    } else {
      logger.warn('No resolver found for session complete', {
        sessionId,
        pendingResolvers: Array.from(sessionCompleteResolvers.keys()),
      });
    }
  }

  /**
   * Complete the loop
   */
  private async completeLoop(ralphId: string, type: string, reason: string): Promise<void> {
    logger.info('Completing ralph loop', { ralphId, type, reason });

    const { ralphStore } = await this.ensureStores();
    await ralphStore.updateLoopStatus(ralphId, 'completed', `${type}: ${reason}`);

    this.activeRunners.delete(ralphId);
    this.emitEvent({ type: 'loop-completed', ralphId, reason });
  }

  /**
   * Block the loop (Claude indicated it's stuck and needs user input)
   */
  private async blockLoop(ralphId: string, reason: string): Promise<void> {
    logger.info('Blocking ralph loop', { ralphId, reason });

    const { ralphStore } = await this.ensureStores();
    await ralphStore.updateLoopStatus(ralphId, 'blocked', reason);

    this.activeRunners.delete(ralphId);
    this.emitEvent({ type: 'loop-blocked', ralphId, reason });
  }

  /**
   * Handle loop error
   */
  private async handleLoopError(ralphId: string, error: unknown): Promise<void> {
    logger.error('Ralph loop error', { ralphId, error });

    const { ralphStore } = await this.ensureStores();
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    await ralphStore.updateLoopStatus(ralphId, 'failed', errorMessage);

    this.activeRunners.delete(ralphId);
    this.emitEvent({ type: 'loop-failed', ralphId, error: errorMessage });
  }

  // ========================================
  // File Management
  // ========================================

  /**
   * Initialize .ralph/ directory with task and config files
   */
  private async initializeRalphFiles(
    worktreePath: string,
    taskDescription: string,
    maxIterations: number
  ): Promise<void> {
    const ralphDir = path.join(worktreePath, '.ralph');

    // Create .ralph directory if it doesn't exist
    await fs.promises.mkdir(ralphDir, { recursive: true });

    // Write task.md
    const taskPath = path.join(ralphDir, 'task.md');
    await fs.promises.writeFile(taskPath, taskDescription, 'utf-8');

    // Write config.json
    const configPath = path.join(ralphDir, 'config.json');
    const config = {
      maxIterations,
      createdAt: new Date().toISOString(),
    };
    await fs.promises.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');

    // Write initial progress.json (atomic write with backup)
    const progress: RalphProgressFile = {
      currentIteration: 0,
      phase: 'planning',
      status: 'running',
      completionSignal: false,
      learnings: [],
      blockers: [],
    };
    await this.writeProgressFile(worktreePath, progress);

    // Create empty IMPLEMENTATION_PLAN.md
    const planPath = path.join(ralphDir, 'IMPLEMENTATION_PLAN.md');
    await fs.promises.writeFile(planPath, '# Implementation Plan\n\n<!-- Generated by Ralph Loop - Claude will populate this during planning phase -->\n', 'utf-8');

    // Add .ralph to .gitignore if not already present
    await this.ensureRalphInGitignore(worktreePath);

    logger.info('Ralph files initialized', { worktreePath });
  }

  /**
   * Ensure .ralph is in .gitignore
   */
  private async ensureRalphInGitignore(worktreePath: string): Promise<void> {
    const gitignorePath = path.join(worktreePath, '.gitignore');

    try {
      let content = '';
      try {
        content = await fs.promises.readFile(gitignorePath, 'utf-8');
      } catch {
        // File doesn't exist, will create it
      }

      if (!content.includes('.ralph')) {
        const newContent = content.endsWith('\n') ? content + '.ralph/\n' : content + '\n.ralph/\n';
        await fs.promises.writeFile(gitignorePath, newContent, 'utf-8');
        logger.info('Added .ralph to .gitignore', { worktreePath });
      }
    } catch (error) {
      logger.warn('Failed to update .gitignore', { worktreePath, error });
    }
  }

  /**
   * Read the progress file with fallback to backup on corruption
   */
  private async readProgressFile(worktreePath: string): Promise<RalphProgressFile | null> {
    const progressPath = path.join(worktreePath, '.ralph', 'progress.json');
    const backupPath = progressPath + '.bak';

    try {
      const content = await fs.promises.readFile(progressPath, 'utf-8');
      return JSON.parse(content) as RalphProgressFile;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }

      if (error instanceof SyntaxError) {
        logger.warn('Corrupt progress.json, trying backup', { worktreePath, error: error.message });
        try {
          const backupContent = await fs.promises.readFile(backupPath, 'utf-8');
          return JSON.parse(backupContent) as RalphProgressFile;
        } catch {
          logger.warn('Backup progress.json also unavailable, using default', { worktreePath });
          return {
            currentIteration: 0,
            phase: 'building',
            status: 'running',
            completionSignal: false,
            learnings: [],
            blockers: [],
          };
        }
      }

      logger.warn('Failed to read progress file', { worktreePath, error });
      return null;
    }
  }

  /**
   * Atomically write progress.json with backup
   */
  private async writeProgressFile(worktreePath: string, progress: RalphProgressFile): Promise<void> {
    const progressPath = path.join(worktreePath, '.ralph', 'progress.json');
    const tmpPath = progressPath + '.tmp';
    const backupPath = progressPath + '.bak';

    const data = JSON.stringify(progress, null, 2);

    await fs.promises.writeFile(tmpPath, data, 'utf-8');

    try {
      await fs.promises.copyFile(progressPath, backupPath);
    } catch {
      // Original may not exist on first write
    }

    await fs.promises.rename(tmpPath, progressPath);
  }

  /**
   * Inject a progress.json snapshot as a nimbalyst_tool_use message into the session.
   * This creates a visual widget in the chat transcript showing progress state at that moment.
   */
  private async injectProgressSnapshot(
    sessionId: string,
    worktreePath: string,
    timing: 'iteration-start' | 'iteration-end',
    iterationNumber: number,
    ralphId: string
  ): Promise<void> {
    const progress = await this.readProgressFile(worktreePath);
    if (!progress) return;

    const now = new Date();
    const snapshotId = `ralph-progress-${timing}-${iterationNumber}-${Date.now()}`;

    // Write nimbalyst_tool_use message (creates the tool call in the transcript)
    await AgentMessagesRepository.create({
      sessionId,
      source: 'nimbalyst',
      direction: 'output',
      createdAt: now,
      content: JSON.stringify({
        type: 'nimbalyst_tool_use',
        id: snapshotId,
        name: 'RalphProgressSnapshot',
        input: {
          timing,
          iterationNumber,
          ralphId,
          progress,
          capturedAt: now.getTime(),
        },
      }),
    });

    // Write matching nimbalyst_tool_result so the widget renders as completed
    await AgentMessagesRepository.create({
      sessionId,
      source: 'nimbalyst',
      direction: 'output',
      createdAt: now,
      content: JSON.stringify({
        type: 'nimbalyst_tool_result',
        tool_use_id: snapshotId,
        result: JSON.stringify(progress),
      }),
    });

    logger.info('Injected progress snapshot', { sessionId, timing, iterationNumber });
  }

  // ========================================
  // Exit Condition Detection
  // ========================================

  /**
   * Check exit conditions from progress file
   */
  private async checkExitConditions(worktreePath: string): Promise<RalphExitCondition | null> {
    const progress = await this.readProgressFile(worktreePath);

    if (!progress) {
      return null;
    }

    // Check completion signal
    if (progress.completionSignal === true) {
      logger.info('Exit condition detected: completionSignal=true', {
        worktreePath,
        phase: progress.phase,
        status: progress.status,
        currentIteration: progress.currentIteration,
      });
      return { type: 'completed', reason: 'Task marked as complete in progress.json' };
    }

    // Check blocked status
    if (progress.status === 'blocked') {
      const blockerText = progress.blockers.length > 0
        ? progress.blockers.join(', ')
        : 'Unknown blocker';
      logger.info('Exit condition detected: status=blocked', {
        worktreePath,
        blockers: progress.blockers,
      });
      return { type: 'blocked', reason: blockerText };
    }

    return null;
  }

  // ========================================
  // Prompt Generation
  // ========================================

  /**
   * Generate the planning phase prompt
   * Based on Geoffrey Huntley's Ralph Loop methodology
   */
  private generatePlanPrompt(): string {
    return `0a. Study \`.ralph/task.md\` to understand the task requirements.
0b. Study \`@.ralph/IMPLEMENTATION_PLAN.md\` (if present) to understand the plan so far.
0c. Study the existing codebase to understand shared utilities, patterns, and components.
0d. Reference the project's CLAUDE.md for build commands and project conventions.
0e. Read \`.ralph/progress.json\` - check \`learnings\` from previous iterations and \`userFeedback\` if present.

1. Study \`@.ralph/IMPLEMENTATION_PLAN.md\` (if present; it may be incomplete) and search the existing source code to compare against the task requirements. Analyze findings, prioritize tasks, and create/update \`@.ralph/IMPLEMENTATION_PLAN.md\` as a bullet point list sorted by priority of items yet to be implemented. Consider searching for TODO, minimal implementations, placeholders, skipped/flaky tests, and inconsistent patterns.

IMPORTANT: Plan only. Do NOT implement anything. Do NOT assume functionality is missing; confirm with code search first.

ULTIMATE GOAL: Read \`.ralph/task.md\` for the goal. Consider missing elements and plan accordingly. If an element is missing, search first to confirm it doesn't exist.

BEFORE YOU FINISH: You MUST update \`.ralph/progress.json\` as the last thing you do. This is how state is communicated between iterations. Set the following fields:
- \`"phase": "building"\` to signal that the next iteration should begin building
- \`"status": "running"\`
- \`"learnings"\`: append an entry with \`{ "iteration": <current iteration number>, "summary": "<what you learned/decided this iteration>", "filesChanged": [<files you created or modified>] }\`
- If you are BLOCKED and cannot create a viable plan, set \`"status": "blocked"\` and describe the blocker in the \`"blockers"\` array`;
  }

  /**
   * Generate the building phase prompt
   * Based on Geoffrey Huntley's Ralph Loop methodology
   */
  private generateBuildPrompt(): string {
    return `0a. Study \`.ralph/task.md\` to understand the task requirements.
0b. Study \`@.ralph/IMPLEMENTATION_PLAN.md\` to understand the current plan and priorities.
0c. Reference the project's CLAUDE.md for build commands and project conventions.
0d. Read \`.ralph/progress.json\` - check \`learnings\` from previous iterations to avoid repeating work, and \`userFeedback\` if present (the user has provided guidance to help you).

1. Your task is to implement functionality per the task requirements. Follow \`@.ralph/IMPLEMENTATION_PLAN.md\` and choose the most important incomplete item to address. Before making changes, search the codebase (don't assume not implemented). Complete ONE item per iteration.

2. After implementing functionality, run the tests for that unit of code. If functionality is missing then add it per the task requirements.

3. When you discover issues, immediately update \`@.ralph/IMPLEMENTATION_PLAN.md\` with your findings. When resolved, mark the item complete or remove it.

4. When the tests pass, update \`@.ralph/IMPLEMENTATION_PLAN.md\`, then commit your changes with a descriptive message.

IMPORTANT RULES:
- Single sources of truth, no migrations/adapters. If tests unrelated to your work fail, resolve them as part of the increment.
- Keep \`@.ralph/IMPLEMENTATION_PLAN.md\` current with learnings - future iterations depend on this to avoid duplicating efforts.
- Implement functionality completely. Placeholders and stubs waste effort by requiring work to be redone.
- When \`@.ralph/IMPLEMENTATION_PLAN.md\` becomes large, clean out completed items.
- For any bugs you notice, resolve them or document them in \`@.ralph/IMPLEMENTATION_PLAN.md\`.

BEFORE YOU FINISH: You MUST update \`.ralph/progress.json\` as the LAST thing you do every iteration. This file is how state is communicated between iterations - the next iteration starts with fresh context and depends on this file. Update these fields:
- \`"learnings"\`: append an entry with \`{ "iteration": <current iteration number>, "summary": "<what you accomplished, key decisions, and anything the next iteration needs to know>", "filesChanged": [<files you created or modified>] }\`
- \`"status"\`: keep as \`"running"\` if work remains
- \`"completionSignal"\`: set to \`true\` ONLY when ALL items in \`@.ralph/IMPLEMENTATION_PLAN.md\` are complete and the task from \`.ralph/task.md\` is fully satisfied
- If you are BLOCKED and cannot make progress, set \`"status": "blocked"\` and describe the blocker in the \`"blockers"\` array`;
  }

  /**
   * Generate the system prompt for a ralph iteration
   * Selects plan or build prompt based on current phase
   */
  private generateRalphPrompt(phase: 'planning' | 'building'): string {
    if (phase === 'planning') {
      return this.generatePlanPrompt();
    }
    return this.generateBuildPrompt();
  }

  // ========================================
  // Event Emission
  // ========================================

  /**
   * Emit a ralph loop event to all windows
   */
  private emitEvent(event: RalphLoopEvent): void {
    const windows = BrowserWindow.getAllWindows();
    for (const window of windows) {
      if (!window.isDestroyed()) {
        window.webContents.send('ralph:event', event);
      }
    }
  }

  /**
   * Emit an iteration prompt to a single renderer window for processing.
   * Only sends to one window to prevent duplicate AI session handling.
   * Prefers the focused window, falls back to the first non-destroyed window.
   */
  private emitIterationPrompt(
    ralphId: string,
    sessionId: string,
    prompt: string,
    worktreePath: string,
    workspaceId: string
  ): void {
    const windows = BrowserWindow.getAllWindows();
    // Prefer focused window, fall back to first available
    const target = windows.find(w => !w.isDestroyed() && w.isFocused())
      || windows.find(w => !w.isDestroyed());
    if (!target) {
      throw new Error('No window available to send iteration prompt');
    }
    logger.info('Sending iteration prompt to window', {
      ralphId,
      sessionId,
      windowId: target.id,
      totalWindows: windows.length,
    });
    target.webContents.send('ralph:iteration-prompt', {
      ralphId,
      sessionId,
      prompt,
      worktreePath,
      workspaceId,
    });
  }

  // ========================================
  // Query Methods
  // ========================================

  /**
   * Get a Ralph Loop by ID
   */
  async getLoop(ralphId: string): Promise<RalphLoop | null> {
    const { ralphStore } = await this.ensureStores();
    return ralphStore.getLoop(ralphId);
  }

  /**
   * Get a Ralph Loop by worktree ID
   */
  async getLoopByWorktreeId(worktreeId: string): Promise<RalphLoop | null> {
    const { ralphStore } = await this.ensureStores();
    return ralphStore.getLoopByWorktreeId(worktreeId);
  }

  /**
   * Get a Ralph Loop with all iterations
   */
  async getLoopWithIterations(ralphId: string): Promise<RalphLoopWithIterations | null> {
    const { ralphStore } = await this.ensureStores();
    return ralphStore.getLoopWithIterations(ralphId);
  }

  /**
   * Get all Ralph Loops for a workspace
   */
  async listLoops(workspaceId: string): Promise<RalphLoop[]> {
    const { ralphStore } = await this.ensureStores();
    return ralphStore.listLoops(workspaceId);
  }

  /**
   * Get runner state for a ralph loop
   */
  getRunnerState(ralphId: string): RalphLoopRunnerState | undefined {
    return this.activeRunners.get(ralphId);
  }

  /**
   * Get the progress file for a Ralph Loop
   */
  async getProgressFile(ralphId: string): Promise<RalphProgressFile | null> {
    const { ralphStore, worktreeStore } = await this.ensureStores();

    const loop = await ralphStore.getLoop(ralphId);
    if (!loop) {
      return null;
    }

    const worktree = await worktreeStore.get(loop.worktreeId);
    if (!worktree) {
      return null;
    }

    return this.readProgressFile(worktree.path);
  }

  /**
   * Update Ralph Loop metadata (title, archive, pin)
   */
  async updateLoop(
    ralphId: string,
    updates: { title?: string; isArchived?: boolean; isPinned?: boolean }
  ): Promise<RalphLoop | null> {
    logger.info('Updating ralph loop', { ralphId, updates });

    const { ralphStore } = await this.ensureStores();
    return ralphStore.updateLoop(ralphId, updates);
  }

  /**
   * Delete a Ralph Loop
   */
  async deleteLoop(ralphId: string): Promise<void> {
    // Stop if running
    if (this.activeRunners.has(ralphId)) {
      await this.stopLoop(ralphId, 'Deleted');
    }

    const { ralphStore } = await this.ensureStores();
    await ralphStore.deleteLoop(ralphId);

    logger.info('Ralph loop deleted', { ralphId });
  }
}

// Session completion resolvers (for waiting on sessions to complete)
const sessionCompleteResolvers = new Map<string, (result: { success: boolean }) => void>();

// Pause resolvers (for event-driven pause waiting)
const pauseResolvers = new Map<string, () => void>();

// Clean up dangling resolvers when all windows are closed.
// If the renderer process is gone, no session-complete notification
// can arrive, so resolve all pending promises to unblock runLoop.
app.on('window-all-closed', () => {
  if (sessionCompleteResolvers.size > 0) {
    logger.warn('All windows closed with pending session resolvers, resolving as interrupted', {
      count: sessionCompleteResolvers.size,
    });
    for (const [sessionId, resolver] of sessionCompleteResolvers) {
      sessionCompleteResolvers.delete(sessionId);
      resolver({ success: false });
    }
  }
});

// Export singleton getter
export function getRalphLoopService(): RalphLoopService {
  return RalphLoopService.getInstance();
}
