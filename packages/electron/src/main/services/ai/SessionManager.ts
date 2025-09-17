/**
 * Manages AI chat sessions across all providers
 */

import Store from 'electron-store';
import { v4 as uuidv4 } from 'uuid';
import { SessionData, Message, DocumentContext, AIProviderType } from './types';

export class SessionManager {
  private store: Store | null = null;
  // REMOVED currentSession and currentWorkspacePath - they cause cross-window contamination!
  // Each window should track its own session by ID

  constructor() {
    // Lazy initialization - will be created on first use
  }

  private getStore(): Store {
    if (!this.store) {
      this.store = new Store({
        name: 'ai-sessions',
        schema: {
          sessionsByWorkspace: {
            type: 'object',
            default: {}
          },
          currentSessionByWorkspace: {
            type: 'object',
            default: {}
          }
        }
      });
    }
    return this.store;
  }

  /**
   * Create a new session
   */
  async createSession(
    provider: AIProviderType,
    documentContext?: DocumentContext,
    workspacePath?: string,
    providerConfig?: any,
    model?: string
  ): Promise<SessionData> {
    const sessionId = uuidv4();
    const workspace = workspacePath || documentContext?.filePath?.split('/').slice(0, -1).join('/') || 'default';
    
    const session: SessionData = {
      id: sessionId,
      provider,
      model,
      timestamp: Date.now(),
      messages: [],
      documentContext,
      workspacePath: workspace,
      title: 'New conversation',
      providerConfig
    };

    this.currentSession = session;
    this.currentWorkspacePath = workspace;
    this.saveSession(session);

    // Set as current session for this workspace
    const currentByWorkspace = this.getStore().get('currentSessionByWorkspace', {}) as Record<string, string>;
    currentByWorkspace[workspace] = sessionId;
    this.getStore().set('currentSessionByWorkspace', currentByWorkspace);

    return session;
  }

  /**
   * Load an existing session
   */
  loadSession(sessionId: string, workspacePath?: string): SessionData | null {
    const workspace = workspacePath || this.currentWorkspacePath || 'default';
    const sessionsByWorkspace = this.getStore().get('sessionsByWorkspace', {}) as Record<string, SessionData[]>;
    const sessions = sessionsByWorkspace[workspace] || [];
    const session = sessions.find(s => s.id === sessionId);
    
    if (session) {
      // Clean up any empty messages that might have been saved before the fix
      // BUT keep tool messages that have toolCall data
      const originalMessageCount = session.messages.length;
      session.messages = session.messages.filter(msg => {
        // Keep messages with content
        if (msg.content && msg.content.trim() !== '') return true;
        // Also keep tool messages with toolCall data
        if (msg.role === 'tool' && msg.toolCall) return true;
        // Filter out truly empty messages
        return false;
      });
      
      if (session.messages.length < originalMessageCount) {
        console.log(`[SessionManager] Cleaned ${originalMessageCount - session.messages.length} empty messages from session ${sessionId}`);
        // Save the cleaned session
        this.saveSession(session);
      }
      
      this.currentSession = session;
      this.currentWorkspacePath = workspace;

      // Set as current session for this workspace
      const currentByWorkspace = this.getStore().get('currentSessionByWorkspace', {}) as Record<string, string>;
      currentByWorkspace[workspace] = sessionId;
      this.getStore().set('currentSessionByWorkspace', currentByWorkspace);

      return session;
    }
    
    return null;
  }

  /**
   * Get all sessions for a workspace
   */
  getSessions(workspacePath?: string): SessionData[] {
    const workspace = workspacePath || this.currentWorkspacePath || 'default';
    const sessionsByWorkspace = this.getStore().get('sessionsByWorkspace', {}) as Record<string, SessionData[]>;
    const sessions = sessionsByWorkspace[workspace] || [];
    // Sort by timestamp descending (newest first)
    return sessions.sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * Get the current session
   */
  getCurrentSession(): SessionData | null {
    return this.currentSession;
  }

  /**
   * Add a message to a specific session
   */
  addMessage(message: Message, sessionId?: string): void {
    // Use provided sessionId or fall back to current session
    const targetSessionId = sessionId || this.currentSession?.id;
    
    if (!targetSessionId) {
      throw new Error('No session ID provided and no current session loaded');
    }
    
    // Find the session by ID across all workspaces
    const sessionsByWorkspace = this.getStore().get('sessionsByWorkspace', {}) as Record<string, SessionData[]>;
    let targetSession: SessionData | null = null;
    let targetWorkspace: string | null = null;
    
    // Search through all workspaces to find the session
    for (const [workspace, sessions] of Object.entries(sessionsByWorkspace)) {
      const session = sessions.find(s => s.id === targetSessionId);
      if (session) {
        targetSession = session;
        targetWorkspace = workspace;
        break;
      }
    }
    
    if (!targetSession || !targetWorkspace) {
      throw new Error(`Session not found: ${targetSessionId}`);
    }
    
    // Validate message content - but allow tool messages with toolCall data
    if ((!message.content || message.content.trim() === '') && 
        !(message.role === 'tool' && message.toolCall)) {
      console.warn('Attempted to add message with empty content and no toolCall, skipping:', message);
      return;
    }
    
    targetSession.messages.push(message);
    
    // Generate title from first user message if not already set
    if (targetSession.messages.length === 1 && 
        message.role === 'user' &&
        (!targetSession.title || targetSession.title === 'New conversation')) {
      targetSession.title = this.generateSessionTitle(message.content);
    }
    
    // Save the updated session
    const updatedSessions = sessionsByWorkspace[targetWorkspace].map(s =>
      s.id === targetSessionId ? targetSession : s
    );
    sessionsByWorkspace[targetWorkspace] = updatedSessions;
    this.getStore().set('sessionsByWorkspace', sessionsByWorkspace);
    
    // Update current session if it matches
    if (this.currentSession?.id === targetSessionId) {
      this.currentSession = targetSession;
    }
  }

  /**
   * Update session messages (for syncing streaming messages)
   */
  updateSessionMessages(sessionId: string, messages: Message[], workspacePath?: string): boolean {
    const workspace = workspacePath || this.currentWorkspacePath || 'default';
    const sessionsByWorkspace = this.getStore().get('sessionsByWorkspace', {}) as Record<string, SessionData[]>;
    const sessions = sessionsByWorkspace[workspace] || [];
    const session = sessions.find(s => s.id === sessionId);

    if (session) {
      session.messages = messages;
      this.saveSession(session);

      // Update current session if it matches
      if (this.currentSession?.id === sessionId) {
        this.currentSession = session;
      }

      return true;
    }

    return false;
  }

  /**
   * Save draft input for a session
   */
  saveDraftInput(sessionId: string, draftInput: string, workspacePath?: string): boolean {
    const workspace = workspacePath || this.currentWorkspacePath || 'default';
    const sessionsByWorkspace = this.getStore().get('sessionsByWorkspace', {}) as Record<string, SessionData[]>;
    const sessions = sessionsByWorkspace[workspace] || [];
    const session = sessions.find(s => s.id === sessionId);

    if (session) {
      session.draftInput = draftInput;
      this.saveSession(session);

      // Update current session if it matches
      if (this.currentSession?.id === sessionId) {
        this.currentSession.draftInput = draftInput;
      }

      return true;
    }

    return false;
  }

  /**
   * Update provider-specific session data
   */
  updateProviderSessionData(sessionId: string, providerSessionId: string): void {
    if (this.currentSession?.id === sessionId) {
      this.currentSession.providerSessionId = providerSessionId;
      this.saveSession(this.currentSession);
    } else {
      // Find and update the session
      const sessions = this.getSessions();
      const session = sessions.find(s => s.id === sessionId);
      if (session) {
        session.providerSessionId = providerSessionId;
        this.saveSession(session);
      }
    }
  }

  /**
   * Delete a session
   */
  deleteSession(sessionId: string, workspacePath?: string): boolean {
    const workspace = workspacePath || this.currentWorkspacePath || 'default';
    const sessionsByWorkspace = this.getStore().get('sessionsByWorkspace', {}) as Record<string, SessionData[]>;
    const sessions = sessionsByWorkspace[workspace] || [];

    // Filter out the session to delete
    const updatedSessions = sessions.filter(s => s.id !== sessionId);

    // Update the store
    sessionsByWorkspace[workspace] = updatedSessions;
    this.getStore().set('sessionsByWorkspace', sessionsByWorkspace);

    // If we deleted the current session, clear it
    if (this.currentSession?.id === sessionId) {
      this.currentSession = null;

      // Clear from current session tracking
      const currentByWorkspace = this.getStore().get('currentSessionByWorkspace', {}) as Record<string, string>;
      if (currentByWorkspace[workspace] === sessionId) {
        delete currentByWorkspace[workspace];
        this.getStore().set('currentSessionByWorkspace', currentByWorkspace);
      }
    }

    return true;
  }

  /**
   * Clear the current session
   */
  clearCurrentSession(): void {
    this.currentSession = null;
  }

  /**
   * Save a session to the store
   */
  private saveSession(session: SessionData): void {
    const workspace = session.workspacePath || this.currentWorkspacePath || 'default';
    const sessionsByWorkspace = this.getStore().get('sessionsByWorkspace', {}) as Record<string, SessionData[]>;
    
    if (!sessionsByWorkspace[workspace]) {
      sessionsByWorkspace[workspace] = [];
    }
    
    const sessions = sessionsByWorkspace[workspace];
    const index = sessions.findIndex(s => s.id === session.id);
    
    if (index >= 0) {
      sessions[index] = session;
    } else {
      sessions.push(session);
    }
    
    // Keep only last 50 sessions per workspace
    if (sessions.length > 50) {
      sessions.splice(0, sessions.length - 50);
    }
    
    sessionsByWorkspace[workspace] = sessions;
    this.getStore().set('sessionsByWorkspace', sessionsByWorkspace);
  }

  /**
   * Clean up empty messages from all sessions
   */
  cleanupAllSessions(): number {
    const sessionsByWorkspace = this.getStore().get('sessionsByWorkspace', {}) as Record<string, SessionData[]>;
    let totalCleaned = 0;
    
    for (const workspace in sessionsByWorkspace) {
      const sessions = sessionsByWorkspace[workspace];
      for (const session of sessions) {
        const originalCount = session.messages.length;
        session.messages = session.messages.filter(msg => {
          // Keep messages with content
          if (msg.content && msg.content.trim() !== '') return true;
          // Also keep tool messages with toolCall data
          if (msg.role === 'tool' && msg.toolCall) return true;
          // Filter out truly empty messages
          return false;
        });
        
        const cleaned = originalCount - session.messages.length;
        if (cleaned > 0) {
          totalCleaned += cleaned;
          console.log(`[SessionManager] Cleaned ${cleaned} empty messages from session ${session.id} in workspace ${workspace}`);
        }
      }
    }
    
    if (totalCleaned > 0) {
      this.getStore().set('sessionsByWorkspace', sessionsByWorkspace);
      console.log(`[SessionManager] Total cleaned: ${totalCleaned} empty messages across all sessions`);
    }
    
    return totalCleaned;
  }

  /**
   * Generate a session title from the first message
   */
  private generateSessionTitle(firstMessage: string): string {
    // Clean and truncate the message for a title
    let title = firstMessage
      .replace(/[\n\r]+/g, ' ')  // Replace newlines with spaces
      .replace(/\s+/g, ' ')       // Normalize whitespace
      .trim();

    // If message starts with common patterns, extract the main topic
    const patterns = [
      /^(can you |could you |please |help me |i need to |i want to |how do i |how to |what is |what are |where is |where are |why is |why are |when is |when are )/i,
      /^(add |create |make |build |implement |fix |update |modify |change |refactor |optimize |debug |test |write |generate )/i
    ];

    for (const pattern of patterns) {
      if (pattern.test(title)) {
        title = title.replace(pattern, '');
        break;
      }
    }

    // Capitalize first letter
    title = title.charAt(0).toUpperCase() + title.slice(1);

    // Truncate to reasonable length (50 chars) and add ellipsis if needed
    if (title.length > 50) {
      title = title.substring(0, 47) + '...';
    }

    // If title is too short or empty, use a default
    if (title.length < 3) {
      title = 'New conversation';
    }

    return title;
  }
}