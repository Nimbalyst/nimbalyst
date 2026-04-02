import path from 'path';
import { BrowserWindow } from 'electron';
import { randomUUID } from 'crypto';
import { safeHandle } from '../utils/ipcRegistry';
import { ClaudeCodeProvider, OpenAICodexProvider, SessionManager } from '@nimbalyst/runtime/ai/server';
import type { AIProviderType } from '@nimbalyst/runtime/ai/server/types';
import { ModelIdentifier } from '@nimbalyst/runtime/ai/server/types';
import { AISessionsRepository, AgentMessagesRepository, SessionFilesRepository } from '@nimbalyst/runtime';
import { getSessionStateManager } from '@nimbalyst/runtime/ai/server/SessionStateManager';
import { getDefaultAIModel } from '../utils/store';
import { createWorktreeStore } from './WorktreeStore';
import { GitWorktreeService } from './GitWorktreeService';
import { database as databaseWorker } from '../database/PGLiteDatabaseWorker';
import { getDatabase } from '../database/initialize';
import { gitRefWatcher } from '../file/GitRefWatcher';
import { AIService } from './ai/AIService';
import {
  startMetaAgentServer,
  setMetaAgentToolFns,
  shutdownMetaAgentServer,
} from '../mcp/metaAgentServer';

type SessionStatusValue = 'idle' | 'running' | 'waiting_for_input' | 'error' | 'interrupted';
type PromptType = 'permission_request' | 'ask_user_question_request' | 'exit_plan_mode_request';

interface PendingInteractivePrompt {
  id: string;
  promptId: string;
  promptType: PromptType;
  createdAt: number;
  content: Record<string, any>;
}

interface SessionResultData {
  sessionId: string;
  title: string;
  provider: string;
  model: string | null;
  status: SessionStatusValue;
  lastActivity: number | null;
  originalPrompt: string | null;
  userPrompts: string[];
  lastResponse: string | null;
  recentMessages: Array<{ direction: 'input' | 'output'; text: string }>;
  editedFiles: string[];
  pendingPrompt: PendingInteractivePrompt | null;
  errorMessage?: string | null;
  createdAt: number;
  updatedAt: number;
  worktreeId?: string | null;
}

interface CreateChildSessionArgs {
  title?: string;
  provider?: string;
  model?: string;
  prompt?: string;
  useWorktree?: boolean;
  worktreeId?: string;
}

export class MetaAgentService {
  private static instance: MetaAgentService | null = null;
  private starting: Promise<void> | null = null;
  private started = false;
  private serverPort: number | null = null;
  private aiService: AIService | null = null;
  private sessionManager: SessionManager | null = null;
  private unsubscribeStateListener: (() => void) | null = null;
  private notificationSignatures = new Map<string, string>();
  private notificationCounter = 0;
  private ipcHandlersRegistered = false;

  private constructor() {}

  public static getInstance(): MetaAgentService {
    if (!MetaAgentService.instance) {
      MetaAgentService.instance = new MetaAgentService();
    }
    return MetaAgentService.instance;
  }

  public getPort(): number | null {
    return this.serverPort;
  }

  private shouldBypassChildAgentExecutionForTests(): boolean {
    return (
      process.env.PLAYWRIGHT === '1' ||
      process.env.PLAYWRIGHT_TEST === 'true' ||
      process.env.NODE_ENV === 'test'
    );
  }

  private async persistSyntheticInputMessage(sessionId: string, prompt: string): Promise<void> {
    await AgentMessagesRepository.create({
      sessionId,
      source: 'nimbalyst-meta-agent',
      direction: 'input',
      content: prompt,
      createdAt: new Date(),
      searchable: true,
    });
  }

  public async start(aiService: AIService): Promise<void> {
    if (this.started) {
      return;
    }

    if (this.starting) {
      await this.starting;
      return;
    }

    this.starting = (async () => {
      this.aiService = aiService;
      this.sessionManager = new SessionManager();
      await this.sessionManager.initialize();

      setMetaAgentToolFns({
        listWorktrees: (_metaSessionId, workspaceId) =>
          this.listWorktreesJson(workspaceId),
        createSession: (metaSessionId, workspaceId, args) =>
          this.createChildSession(metaSessionId, workspaceId, args),
        getSessionStatus: (_metaSessionId, workspaceId, targetSessionId) =>
          this.getSessionStatusJson(targetSessionId, workspaceId),
        getSessionResult: (_metaSessionId, workspaceId, targetSessionId) =>
          this.getSessionResultJson(targetSessionId, workspaceId),
        sendPrompt: (_metaSessionId, workspaceId, targetSessionId, prompt) =>
          this.sendPromptToSession(targetSessionId, workspaceId, prompt),
        respondToPrompt: (_metaSessionId, workspaceId, args) =>
          this.respondToPrompt(workspaceId, args),
        listSpawnedSessions: (metaSessionId, workspaceId) =>
          this.listSpawnedSessionsJson(metaSessionId, workspaceId),
      });

      const result = await startMetaAgentServer();
      this.serverPort = result.port;
      console.log(`[MetaAgentService] MCP server started on port ${result.port}`);

      ClaudeCodeProvider.setMetaAgentServerPort(result.port);
      OpenAICodexProvider.setMetaAgentServerPort(result.port);

      this.unsubscribeStateListener = getSessionStateManager().subscribe((event) => {
        if (event.type === 'session:completed' || event.type === 'session:error' || event.type === 'session:waiting' || event.type === 'session:interrupted') {
          void this.handleChildSessionEvent(event.sessionId, event.type);
        }
      });

      this.registerIpcHandlers();
      this.started = true;
    })();

    try {
      await this.starting;
    } finally {
      this.starting = null;
    }
  }

  public async shutdown(): Promise<void> {
    if (!this.started) {
      return;
    }

    this.unsubscribeStateListener?.();
    this.unsubscribeStateListener = null;
    this.notificationSignatures.clear();
    this.notificationCounter = 0;
    await shutdownMetaAgentServer();
    ClaudeCodeProvider.setMetaAgentServerPort(null);
    OpenAICodexProvider.setMetaAgentServerPort(null);
    this.serverPort = null;
    this.started = false;
  }

  private registerIpcHandlers(): void {
    if (this.ipcHandlersRegistered) {
      return;
    }

    safeHandle('meta-agent:list-spawned-sessions', async (_event, metaSessionId: string, workspaceId: string) => {
      try {
        const sessions = await this.getSpawnedSessions(metaSessionId, workspaceId);
        return { success: true, sessions };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error), sessions: [] };
      }
    });

    if (process.env.PLAYWRIGHT === '1' || process.env.PLAYWRIGHT_TEST === 'true' || process.env.NODE_ENV === 'test') {
      safeHandle('meta-agent:get-server-port', async () => {
        return { success: true, port: this.serverPort };
      });
    }

    this.ipcHandlersRegistered = true;
  }

  private async createChildSession(
    metaSessionId: string,
    workspaceId: string,
    args: CreateChildSessionArgs
  ): Promise<string> {
    if (!this.aiService) {
      throw new Error('AI service not initialized');
    }
    if (args.useWorktree && args.worktreeId) {
      throw new Error('useWorktree and worktreeId cannot be combined');
    }

    const defaultModel = getDefaultAIModel() || 'claude-code:opus';
    const model = args.model || defaultModel;
    const parsed = ModelIdentifier.tryParse(model);
    const provider = (args.provider || parsed?.provider || 'claude-code') as AIProviderType;
    const normalizedModel = args.model || ModelIdentifier.getDefaultModelId(provider);
    const title = (args.title || this.deriveTitleFromPrompt(args.prompt) || 'Meta Task').trim();

    let worktreeId: string | null = null;
    let worktreePath: string | null = null;

    const db = getDatabase();
    if ((args.useWorktree || args.worktreeId) && !db) {
      throw new Error('Database not initialized');
    }
    const worktreeStore = db ? createWorktreeStore(db) : null;

    if (args.worktreeId) {
      if (!worktreeStore) {
        throw new Error('Worktree store not initialized');
      }

      const existingWorktree = await worktreeStore.get(args.worktreeId);
      if (!existingWorktree) {
        throw new Error(`Worktree ${args.worktreeId} not found`);
      }
      if (existingWorktree.projectPath !== workspaceId) {
        throw new Error(`Worktree ${args.worktreeId} does not belong to this workspace`);
      }
      if (existingWorktree.isArchived) {
        throw new Error(`Worktree ${args.worktreeId} is archived`);
      }

      worktreeId = existingWorktree.id;
      worktreePath = existingWorktree.path;
    } else if (args.useWorktree) {
      if (!worktreeStore) {
        throw new Error('Worktree store not initialized');
      }

      const gitWorktreeService = new GitWorktreeService();
      const [dbNames, filesystemNames, branchNames] = await Promise.all([
        worktreeStore.getAllNames(),
        Promise.resolve(gitWorktreeService.getExistingWorktreeDirectories(workspaceId)),
        gitWorktreeService.getAllBranchNames(workspaceId),
      ]);
      const existingNames = new Set<string>();
      for (const name of dbNames) existingNames.add(name);
      for (const name of filesystemNames) existingNames.add(name);
      for (const name of branchNames) existingNames.add(name);
      const finalName = gitWorktreeService.generateUniqueWorktreeName(existingNames);
      const worktree = await gitWorktreeService.createWorktree(workspaceId, { name: finalName });
      await worktreeStore.create(worktree);
      gitRefWatcher.start(worktree.path).catch((error: Error) => {
        console.error('[MetaAgentService] Failed to start GitRefWatcher for meta-agent worktree:', error);
      });
      worktreeId = worktree.id;
      worktreePath = worktree.path;
    }

    const sessionId = randomUUID();
    await AISessionsRepository.create({
      id: sessionId,
      provider,
      model: normalizedModel,
      title,
      workspaceId,
      worktreeId: worktreeId ?? undefined,
      agentRole: 'standard',
      createdBySessionId: metaSessionId,
    });

    const initialPrompt = args.prompt?.trim();
    const shouldBypassExecution = this.shouldBypassChildAgentExecutionForTests();

    if (initialPrompt) {
      if (shouldBypassExecution) {
        await this.persistSyntheticInputMessage(sessionId, initialPrompt);
      } else {
        await this.aiService.queuePromptForSession(sessionId, initialPrompt);
      }
    }

    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send('sessions:refresh-list', {
          workspacePath: workspaceId,
          sessionId,
        });
        if (worktreeId) {
          window.webContents.send('worktree:session-created', { sessionId, worktreeId });
        }
      }
    }

    if (initialPrompt && !shouldBypassExecution) {
      await this.aiService.triggerQueuedPromptProcessingForSession(sessionId, worktreePath || workspaceId);
    }

    return JSON.stringify({
      sessionId,
      title,
      provider,
      model: normalizedModel,
      worktreeId,
      worktreePath,
      worktreeMode: args.worktreeId ? 'existing' : args.useWorktree ? 'new' : 'none',
      createdBySessionId: metaSessionId,
      queuedInitialPrompt: !!args.prompt?.trim(),
    }, null, 2);
  }

  private async listWorktreesJson(workspaceId: string): Promise<string> {
    const db = getDatabase();
    if (!db) {
      throw new Error('Database not initialized');
    }

    const worktreeStore = createWorktreeStore(db);
    const worktrees = await worktreeStore.list(workspaceId);
    const summaries = await Promise.all(
      worktrees.map(async (worktree) => {
        const sessionIds = await worktreeStore.getWorktreeSessions(worktree.id);
        return {
          id: worktree.id,
          name: worktree.name,
          displayName: worktree.displayName || null,
          path: worktree.path,
          branch: worktree.branch,
          baseBranch: worktree.baseBranch,
          sessionCount: sessionIds.length,
          createdAt: worktree.createdAt,
          updatedAt: worktree.updatedAt ?? null,
        };
      })
    );

    return JSON.stringify(summaries, null, 2);
  }

  private async getSessionStatusJson(sessionId: string, workspaceId: string): Promise<string> {
    const row = await this.getSessionStatusRow(sessionId, workspaceId);
    if (!row) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const status = row.status || 'idle';
    const result: Record<string, unknown> = {
      sessionId: row.id,
      title: row.title || 'Untitled Session',
      status,
      lastActivity: row.last_activity ? new Date(row.last_activity).getTime() : null,
      updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : null,
      provider: row.provider,
      model: row.model || null,
      createdBySessionId: row.created_by_session_id || null,
      agentRole: row.agent_role || 'standard',
      waitingForInput: status === 'waiting_for_input',
    };

    return JSON.stringify(result, null, 2);
  }

  private async getSessionResultJson(sessionId: string, workspaceId: string): Promise<string> {
    const data = await this.buildSessionResultData(sessionId, workspaceId);
    return JSON.stringify(data, null, 2);
  }

  private async sendPromptToSession(sessionId: string, workspaceId: string, prompt: string): Promise<string> {
    if (!this.aiService) {
      throw new Error('AI service not initialized');
    }
    if (!prompt?.trim()) {
      throw new Error('prompt is required');
    }

    const session = await AISessionsRepository.get(sessionId);
    if (!session || session.workspacePath !== workspaceId) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const normalizedPrompt = prompt.trim();
    const shouldBypassExecution = this.shouldBypassChildAgentExecutionForTests();
    const statusRow = await this.getSessionStatusRow(sessionId, workspaceId);
    const statusBeforeQueue = (statusRow?.status || 'idle') as SessionStatusValue;

    if (shouldBypassExecution) {
      await this.persistSyntheticInputMessage(sessionId, normalizedPrompt);
      return JSON.stringify({
        sessionId,
        queuedPromptId: null,
        prompt: normalizedPrompt,
        statusBeforeQueue,
        processingTriggered: false,
        bypassedExecutionForTest: true,
      }, null, 2);
    }

    const queued = await this.aiService.queuePromptForSession(sessionId, normalizedPrompt);
    const status = (statusRow?.status || 'idle') as SessionStatusValue;
    const processingTriggered = status === 'idle' || status === 'interrupted' || status === 'error';

    if (processingTriggered) {
      await this.aiService.triggerQueuedPromptProcessingForSession(
        sessionId,
        session.worktreePath || session.workspacePath || workspaceId
      );
    }

    return JSON.stringify({
      sessionId,
      queuedPromptId: queued.id,
      prompt: queued.prompt,
      statusBeforeQueue: status,
      processingTriggered,
    }, null, 2);
  }

  private async respondToPrompt(workspaceId: string, args: {
    sessionId: string;
    promptId: string;
    promptType: PromptType;
    response: Record<string, unknown>;
  }): Promise<string> {
    if (!this.aiService) {
      throw new Error('AI service not initialized');
    }

    const session = await AISessionsRepository.get(args.sessionId);
    if (!session || session.workspacePath !== workspaceId) {
      throw new Error(`Session ${args.sessionId} not found`);
    }

    const result = await this.aiService.respondToInteractivePrompt({
      sessionId: args.sessionId,
      promptId: args.promptId,
      promptType: args.promptType,
      response: args.response,
      respondedBy: 'desktop',
    });

    if (!result.success) {
      throw new Error(result.error || 'Failed to respond to prompt');
    }

    return JSON.stringify({
      sessionId: args.sessionId,
      promptId: args.promptId,
      promptType: args.promptType,
      success: true,
    }, null, 2);
  }

  private async listSpawnedSessionsJson(metaSessionId: string, workspaceId: string): Promise<string> {
    const sessions = await this.getSpawnedSessions(metaSessionId, workspaceId);
    return JSON.stringify(sessions, null, 2);
  }

  private async getSpawnedSessions(metaSessionId: string, workspaceId: string): Promise<Array<Record<string, unknown>>> {
    const { rows } = await databaseWorker.query<any>(
      `SELECT id, title, provider, model, status, last_activity, created_at, updated_at, worktree_id, agent_role, created_by_session_id
       FROM ai_sessions
       WHERE workspace_id = $1
         AND created_by_session_id = $2
         AND (is_archived = FALSE OR is_archived IS NULL)
       ORDER BY created_at DESC`,
      [workspaceId, metaSessionId]
    );

    const sessions: Array<Record<string, unknown>> = [];
    for (const row of rows) {
      const data = await this.buildSessionResultData(row.id, workspaceId, {
        title: row.title || 'Untitled Session',
        provider: row.provider,
        model: row.model || null,
        status: row.status || 'idle',
        lastActivity: row.last_activity ? new Date(row.last_activity).getTime() : null,
        createdAt: row.created_at instanceof Date ? row.created_at.getTime() : new Date(row.created_at).getTime(),
        updatedAt: row.updated_at instanceof Date ? row.updated_at.getTime() : new Date(row.updated_at).getTime(),
        worktreeId: row.worktree_id || null,
      });
      sessions.push({
        sessionId: data.sessionId,
        title: data.title,
        provider: data.provider,
        model: data.model,
        status: data.status,
        lastActivity: data.lastActivity,
        originalPrompt: data.originalPrompt,
        lastResponse: data.lastResponse,
        editedFiles: data.editedFiles,
        pendingPrompt: data.pendingPrompt,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
        worktreeId: data.worktreeId || null,
      });
    }

    return sessions;
  }

  private async handleChildSessionEvent(sessionId: string, eventType: 'session:completed' | 'session:error' | 'session:waiting' | 'session:interrupted'): Promise<void> {
    try {
      if (!this.aiService) {
        return;
      }

      const session = await AISessionsRepository.get(sessionId);
      if (!session || session.agentRole === 'meta-agent' || !session.createdBySessionId || !session.workspacePath) {
        return;
      }

      const metaSession = await AISessionsRepository.get(session.createdBySessionId);
      if (!metaSession?.workspacePath) {
        return;
      }

      const metaStatusRow = await this.getSessionStatusRow(metaSession.id, metaSession.workspacePath);
      const metaStatus = (metaStatusRow?.status || 'idle') as SessionStatusValue;

      const result = await this.buildSessionResultData(sessionId, session.workspacePath);
      this.notificationCounter += 1;
      const signature = `${eventType}:${result.status}:${result.lastActivity || 0}:${result.pendingPrompt?.promptId || ''}:${this.notificationCounter}`;
      this.notificationSignatures.set(sessionId, signature);

      if (result.pendingPrompt?.promptType === 'exit_plan_mode_request') {
        await this.ensurePlanTrackerItem(session.workspacePath, sessionId, result);
      }

      const notification = this.buildNotificationMessage(eventType, result);
      await this.aiService.queuePromptForSession(session.createdBySessionId, notification);

      if (metaStatus === 'idle' || metaStatus === 'interrupted' || metaStatus === 'error') {
        await this.aiService.triggerQueuedPromptProcessingForSession(metaSession.id, metaSession.workspacePath);
      }
    } catch (error) {
      console.error(`[MetaAgentService] handleChildSessionEvent failed for session ${sessionId} (${eventType}):`, error);
    }
  }

  private buildNotificationMessage(
    eventType: 'session:completed' | 'session:error' | 'session:waiting' | 'session:interrupted',
    result: SessionResultData
  ): string {
    const lines = [
      '[Child Session Update]',
      `Session: "${result.title}" (${result.sessionId})`,
      `Status: ${result.status}`,
      `Event: ${eventType}`,
    ];

    if (result.originalPrompt) {
      lines.push(`Original task: ${result.originalPrompt}`);
    }
    if (result.recentMessages.length > 0) {
      lines.push('Recent messages:');
      for (const message of result.recentMessages) {
        const label = message.direction === 'input' ? 'User' : 'Assistant';
        lines.push(`- ${label}: ${message.text}`);
      }
    } else if (result.lastResponse) {
      lines.push(`Last response: ${result.lastResponse}`);
    }
    if (result.editedFiles.length > 0) {
      lines.push('Files modified:');
      for (const filePath of result.editedFiles) {
        lines.push(`- ${filePath}`);
      }
    }
    if (result.pendingPrompt) {
      lines.push('');
      lines.push(`ACTION REQUIRED: This session is blocked on an interactive prompt.`);
      lines.push(`Use respond_to_prompt with these arguments:`);
      lines.push(`  sessionId: "${result.sessionId}"`);
      lines.push(`  promptId: "${result.pendingPrompt.promptId}"`);
      lines.push(`  promptType: "${result.pendingPrompt.promptType}"`);

      if (result.pendingPrompt.promptType === 'ask_user_question_request') {
        const questions = result.pendingPrompt.content?.questions;
        if (Array.isArray(questions)) {
          lines.push('  Questions:');
          for (const q of questions) {
            const questionText = q.question || q.text || JSON.stringify(q);
            lines.push(`    - ${questionText}`);
            if (Array.isArray(q.options)) {
              for (const opt of q.options) {
                const label = typeof opt === 'string' ? opt : opt.label || opt.value || JSON.stringify(opt);
                lines.push(`      * ${label}`);
              }
            }
          }
        }
        lines.push(`  response format: { "answers": { "<question text>": "<your answer>" } }`);
      } else if (result.pendingPrompt.promptType === 'permission_request') {
        const toolName = result.pendingPrompt.content?.toolName || result.pendingPrompt.content?.request?.tool || 'unknown';
        lines.push(`  Tool requesting permission: ${toolName}`);
        lines.push(`  response: { "decision": "allow", "scope": "session" }`);
      } else if (result.pendingPrompt.promptType === 'exit_plan_mode_request') {
        if (result.pendingPrompt.content?.planFilePath) {
          lines.push(`  Plan file: ${result.pendingPrompt.content.planFilePath}`);
        }
        lines.push(`  response: { "approved": true }`);
      }
    }
    if (result.errorMessage) {
      lines.push(`Error: ${result.errorMessage}`);
    }
    return lines.join('\n');
  }

  private async buildSessionResultData(
    sessionId: string,
    workspaceId: string,
    prefetchedSession?: { title: string; provider: string; model: string | null; status: string; lastActivity: number | null; createdAt: number; updatedAt: number; worktreeId: string | null }
  ): Promise<SessionResultData> {
    let sessionTitle: string;
    let sessionProvider: string;
    let sessionModel: string | null;
    let sessionStatus: SessionStatusValue;
    let sessionLastActivity: number | null;
    let sessionCreatedAt: number;
    let sessionUpdatedAt: number;
    let sessionWorktreeId: string | null;

    if (prefetchedSession) {
      sessionTitle = prefetchedSession.title;
      sessionProvider = prefetchedSession.provider;
      sessionModel = prefetchedSession.model;
      sessionStatus = prefetchedSession.status as SessionStatusValue;
      sessionLastActivity = prefetchedSession.lastActivity;
      sessionCreatedAt = prefetchedSession.createdAt;
      sessionUpdatedAt = prefetchedSession.updatedAt;
      sessionWorktreeId = prefetchedSession.worktreeId;
    } else {
      const session = await AISessionsRepository.get(sessionId);
      if (!session || session.workspacePath !== workspaceId) {
        throw new Error(`Session ${sessionId} not found`);
      }
      const statusRow = await this.getSessionStatusRow(sessionId, workspaceId);
      sessionTitle = session.title || 'Untitled Session';
      sessionProvider = session.provider;
      sessionModel = session.model || null;
      sessionStatus = (statusRow?.status || 'idle') as SessionStatusValue;
      sessionLastActivity = statusRow?.last_activity ? new Date(statusRow.last_activity).getTime() : null;
      sessionCreatedAt = session.createdAt;
      sessionUpdatedAt = session.updatedAt;
      sessionWorktreeId = session.worktreeId || null;
    }

    const messages = await AgentMessagesRepository.list(sessionId, { limit: 500 });
    const userPrompts = this.extractUserPrompts(messages);
    const recentMessages = this.extractRecentMessages(messages, 3);
    const pendingPrompt = await this.getPendingInteractivePrompt(sessionId);

    let editedFiles: string[] = [];
    try {
      const fileLinks = await SessionFilesRepository.getFilesBySession(sessionId, 'edited');
      editedFiles = fileLinks.map((file: any) => this.stripWorkspacePath(file.filePath, workspaceId));
    } catch {
      editedFiles = [];
    }

    return {
      sessionId,
      title: sessionTitle,
      provider: sessionProvider,
      model: sessionModel,
      status: sessionStatus,
      lastActivity: sessionLastActivity,
      originalPrompt: userPrompts[0] || null,
      userPrompts,
      lastResponse: this.extractLastAgentResponse(messages),
      recentMessages,
      editedFiles,
      pendingPrompt,
      errorMessage: this.extractErrorMessage(messages),
      createdAt: sessionCreatedAt,
      updatedAt: sessionUpdatedAt,
      worktreeId: sessionWorktreeId,
    };
  }

  private async getPendingInteractivePrompt(sessionId: string): Promise<PendingInteractivePrompt | null> {
    // Interactive prompts are persisted in three different formats:
    // 1. AskUserQuestion:  { type: "nimbalyst_tool_use", name: "AskUserQuestion", id: "...", input: { questions } }
    // 2. ToolPermission:   { type: "nimbalyst_tool_use", name: "ToolPermission", id: "...", input: { requestId, toolName, ... } }
    // 3. ExitPlanMode:     { type: "exit_plan_mode_request", status: "pending", requestId: "..." }
    const { rows } = await databaseWorker.query<{
      id: string;
      content: string;
      created_at: Date;
    }>(
      `SELECT id, content, created_at
       FROM ai_agent_messages
       WHERE session_id = $1
         AND (hidden = FALSE OR hidden IS NULL)
         AND (
           (content LIKE '%"type":"exit_plan_mode_request"%' AND content LIKE '%"status":"pending"%')
           OR (content LIKE '%"type":"nimbalyst_tool_use"%' AND content LIKE '%"name":"AskUserQuestion"%')
           OR (content LIKE '%"type":"nimbalyst_tool_use"%' AND content LIKE '%"name":"ToolPermission"%')
         )
       ORDER BY created_at ASC`,
      [sessionId]
    );

    for (const row of rows) {
      try {
        const content = JSON.parse(row.content);

        // Handle nimbalyst_tool_use format (AskUserQuestion and ToolPermission)
        if (content.type === 'nimbalyst_tool_use') {
          const promptId = content.id || content.input?.requestId;
          if (!promptId) {
            continue;
          }

          // Check if there's already a response for this prompt
          const escapedPromptId = this.escapeLikePattern(promptId);
          const { rows: resultRows } = await databaseWorker.query<{ id: string }>(
            `SELECT id
             FROM ai_agent_messages
             WHERE session_id = $1
               AND (
                 (content LIKE '%"type":"nimbalyst_tool_result"%' AND content LIKE $2)
                 OR (content LIKE '%"type":"ask_user_question_response"%' AND content LIKE $2)
                 OR (content LIKE '%"type":"permission_response"%' AND content LIKE $2)
               )
             LIMIT 1`,
            [sessionId, `%"${escapedPromptId}"%`]
          );

          if (resultRows.length > 0) {
            continue;
          }

          if (content.name === 'AskUserQuestion') {
            return {
              id: row.id,
              promptId,
              promptType: 'ask_user_question_request',
              createdAt: row.created_at instanceof Date ? row.created_at.getTime() : new Date(row.created_at).getTime(),
              content: {
                ...content,
                questions: content.input?.questions || [],
                questionId: promptId,
              },
            };
          }

          if (content.name === 'ToolPermission') {
            return {
              id: row.id,
              promptId: content.input?.requestId || promptId,
              promptType: 'permission_request',
              createdAt: row.created_at instanceof Date ? row.created_at.getTime() : new Date(row.created_at).getTime(),
              content: {
                type: 'permission_request',
                requestId: content.input?.requestId || promptId,
                toolName: content.input?.toolName || 'unknown',
                rawCommand: content.input?.rawCommand || '',
                pattern: content.input?.pattern || '',
                patternDisplayName: content.input?.patternDisplayName || '',
                isDestructive: content.input?.isDestructive || false,
                warnings: content.input?.warnings || [],
                status: 'pending',
              },
            };
          }

          continue;
        }

        // Handle exit_plan_mode_request format
        if (content.type === 'exit_plan_mode_request' && content.status === 'pending') {
          const promptId = content.requestId;
          if (!promptId) {
            continue;
          }

          const escapedPromptId = this.escapeLikePattern(promptId);
          const { rows: responseRows } = await databaseWorker.query<{ id: string }>(
            `SELECT id
             FROM ai_agent_messages
             WHERE session_id = $1
               AND content LIKE '%"type":"exit_plan_mode_response"%'
               AND content LIKE $2
             LIMIT 1`,
            [sessionId, `%"requestId":"${escapedPromptId}"%`]
          );

          if (responseRows.length > 0) {
            continue;
          }

          return {
            id: row.id,
            promptId,
            promptType: 'exit_plan_mode_request',
            createdAt: row.created_at instanceof Date ? row.created_at.getTime() : new Date(row.created_at).getTime(),
            content,
          };
        }
      } catch {
        continue;
      }
    }

    return null;
  }

  private async getSessionStatusRow(sessionId: string, workspaceId: string): Promise<any | null> {
    const { rows } = await databaseWorker.query<any>(
      `SELECT id, title, provider, model, status, last_activity, updated_at, created_by_session_id, agent_role
       FROM ai_sessions
       WHERE id = $1 AND workspace_id = $2
       LIMIT 1`,
      [sessionId, workspaceId]
    );
    return rows[0] || null;
  }

  private async ensurePlanTrackerItem(workspaceId: string, sessionId: string, result: SessionResultData): Promise<void> {
    const pendingPrompt = result.pendingPrompt;
    if (!pendingPrompt || pendingPrompt.promptType !== 'exit_plan_mode_request') {
      return;
    }

    const sourceRef = `meta-agent-plan:${sessionId}:${pendingPrompt.promptId}`;
    const { rows: existing } = await databaseWorker.query<{ id: string }>(
      `SELECT id FROM tracker_items WHERE workspace = $1 AND source_ref = $2 LIMIT 1`,
      [workspaceId, sourceRef]
    );
    if (existing.length > 0) {
      return;
    }

    const trackerId = randomUUID();
    const title = `Plan review: ${result.title}`;
    const description = typeof pendingPrompt.content.planFilePath === 'string'
      ? `Plan generated by child session ${sessionId}.\nPlan file: ${pendingPrompt.content.planFilePath}`
      : `Plan generated by child session ${sessionId}.`;

    const data = {
      title,
      status: 'in-review',
      priority: 'medium',
      created: new Date().toISOString().split('T')[0],
      description,
      tags: ['meta-agent', 'plan-review'],
      childSessionId: sessionId,
    };

    await databaseWorker.query(
      `INSERT INTO tracker_items (
        id, type, data, workspace, document_path, line_number,
        created, updated, last_indexed, sync_status,
        content, archived, source, source_ref
      ) VALUES ($1, $2, $3, $4, '', NULL, NOW(), NOW(), NOW(), 'pending', $5, FALSE, $6, $7)`,
      [
        trackerId,
        'plan',
        JSON.stringify(data),
        workspaceId,
        JSON.stringify({
          planFilePath: pendingPrompt.content.planFilePath || null,
          allowedPrompts: pendingPrompt.content.allowedPrompts || [],
        }),
        'meta-agent',
        sourceRef,
      ]
    );

    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send('document-service:tracker-items-changed', {
          added: [],
          updated: [],
          removed: [],
          timestamp: new Date(),
        });
      }
    }
  }

  private extractUserPrompts(messages: Array<{ direction: string; content: string }>): string[] {
    const prompts: string[] = [];
    for (const message of messages) {
      if (message.direction !== 'input') continue;
      try {
        const parsed = JSON.parse(message.content);
        if (typeof parsed.prompt === 'string' && parsed.prompt.trim()) {
          prompts.push(parsed.prompt.trim());
        }
      } catch {
        continue;
      }
    }
    return prompts;
  }

  private extractLastAgentResponse(messages: Array<{ direction: string; content: string }>, maxLength: number = 500): string | null {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message.direction !== 'output') continue;
      const extracted = this.extractMessageText(message.content);
      if (extracted) {
        return extracted.length > maxLength ? `${extracted.slice(0, maxLength)}...` : extracted;
      }
    }
    return null;
  }

  private extractRecentMessages(
    messages: Array<{ direction: string; content: string }>,
    limit: number
  ): Array<{ direction: 'input' | 'output'; text: string }> {
    const collected: Array<{ direction: 'input' | 'output'; text: string }> = [];
    for (let index = messages.length - 1; index >= 0 && collected.length < limit; index -= 1) {
      const message = messages[index];
      const text = this.extractMessageText(message.content);
      if (!text) {
        continue;
      }
      collected.push({
        direction: message.direction === 'input' ? 'input' : 'output',
        text,
      });
    }
    return collected.reverse();
  }

  private extractMessageText(rawContent: string): string | null {
    try {
      const parsed = JSON.parse(rawContent);

      if (typeof parsed.prompt === 'string' && parsed.prompt.trim()) {
        return parsed.prompt.trim();
      }

      if (parsed.type === 'text' && typeof parsed.content === 'string' && parsed.content.trim()) {
        return parsed.content.trim();
      }

      if (parsed.type === 'assistant' && Array.isArray(parsed.message?.content)) {
        const text = parsed.message.content
          .filter((block: any) => block.type === 'text' && typeof block.text === 'string')
          .map((block: any) => block.text.trim())
          .filter(Boolean)
          .join('\n');
        return text || null;
      }

      if (parsed.type === 'nimbalyst_tool_use' && parsed.name === 'AskUserQuestion') {
        return 'Interactive prompt: AskUserQuestion';
      }

      if (parsed.type === 'permission_request') {
        return `Permission request: ${parsed.toolName || parsed.requestId || 'unknown tool'}`;
      }

      if (parsed.type === 'exit_plan_mode_request') {
        return `Plan ready for review${parsed.planFilePath ? `: ${parsed.planFilePath}` : ''}`;
      }
    } catch {
      return null;
    }
    return null;
  }

  private extractErrorMessage(messages: Array<{ direction: string; content: string }>): string | null {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      try {
        const parsed = JSON.parse(message.content);
        if (typeof parsed.error === 'string' && parsed.error.trim()) {
          return parsed.error.trim();
        }
      } catch {
        continue;
      }
    }
    return null;
  }

  private deriveTitleFromPrompt(prompt?: string): string | null {
    if (!prompt?.trim()) {
      return null;
    }
    const firstLine = prompt.trim().split('\n')[0].trim();
    if (!firstLine) {
      return null;
    }
    return firstLine.length > 80 ? `${firstLine.slice(0, 77)}...` : firstLine;
  }

  private escapeLikePattern(value: string): string {
    return value.replace(/[%_\\]/g, '\\$&');
  }

  private stripWorkspacePath(filePath: string, workspacePath: string): string {
    if (!workspacePath) return filePath;
    return path.relative(workspacePath, filePath);
  }
}
