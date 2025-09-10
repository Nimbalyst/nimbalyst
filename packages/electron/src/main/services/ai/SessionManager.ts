/**
 * Manages AI chat sessions across all providers
 */

import Store from 'electron-store';
import { v4 as uuidv4 } from 'uuid';
import { SessionData, Message, DocumentContext, AIProviderType } from './types';

export class SessionManager {
  private store: Store | null = null;
  private currentSession: SessionData | null = null;
  private currentProjectPath: string | null = null;

  constructor() {
    // Lazy initialization - will be created on first use
  }

  private getStore(): Store {
    if (!this.store) {
      this.store = new Store({
        name: 'ai-sessions',
        schema: {
          sessionsByProject: {
            type: 'object',
            default: {}
          },
          currentSessionByProject: {
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
    projectPath?: string,
    providerConfig?: any,
    model?: string
  ): Promise<SessionData> {
    const sessionId = uuidv4();
    const project = projectPath || documentContext?.filePath?.split('/').slice(0, -1).join('/') || 'default';
    
    const session: SessionData = {
      id: sessionId,
      provider,
      model,
      timestamp: Date.now(),
      messages: [],
      documentContext,
      projectPath: project,
      title: 'New conversation',
      providerConfig
    };

    this.currentSession = session;
    this.currentProjectPath = project;
    this.saveSession(session);

    // Set as current session for this project
    const currentByProject = this.getStore().get('currentSessionByProject', {}) as Record<string, string>;
    currentByProject[project] = sessionId;
    this.getStore().set('currentSessionByProject', currentByProject);

    return session;
  }

  /**
   * Load an existing session
   */
  loadSession(sessionId: string, projectPath?: string): SessionData | null {
    const project = projectPath || this.currentProjectPath || 'default';
    const sessionsByProject = this.getStore().get('sessionsByProject', {}) as Record<string, SessionData[]>;
    const sessions = sessionsByProject[project] || [];
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
      this.currentProjectPath = project;

      // Set as current session for this project
      const currentByProject = this.getStore().get('currentSessionByProject', {}) as Record<string, string>;
      currentByProject[project] = sessionId;
      this.getStore().set('currentSessionByProject', currentByProject);

      return session;
    }
    
    return null;
  }

  /**
   * Get all sessions for a project
   */
  getSessions(projectPath?: string): SessionData[] {
    const project = projectPath || this.currentProjectPath || 'default';
    const sessionsByProject = this.getStore().get('sessionsByProject', {}) as Record<string, SessionData[]>;
    const sessions = sessionsByProject[project] || [];
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
   * Add a message to the current session
   */
  addMessage(message: Message): void {
    if (!this.currentSession) {
      throw new Error('No session loaded');
    }

    // Validate message content - but allow tool messages with toolCall data
    if ((!message.content || message.content.trim() === '') && 
        !(message.role === 'tool' && message.toolCall)) {
      console.warn('Attempted to add message with empty content and no toolCall, skipping:', message);
      return;
    }

    this.currentSession.messages.push(message);
    
    // Generate title from first user message if not already set
    if (this.currentSession.messages.length === 1 && 
        message.role === 'user' &&
        (!this.currentSession.title || this.currentSession.title === 'New conversation')) {
      this.currentSession.title = this.generateSessionTitle(message.content);
    }

    this.saveSession(this.currentSession);
  }

  /**
   * Update session messages (for syncing streaming messages)
   */
  updateSessionMessages(sessionId: string, messages: Message[], projectPath?: string): boolean {
    const project = projectPath || this.currentProjectPath || 'default';
    const sessionsByProject = this.getStore().get('sessionsByProject', {}) as Record<string, SessionData[]>;
    const sessions = sessionsByProject[project] || [];
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
  saveDraftInput(sessionId: string, draftInput: string, projectPath?: string): boolean {
    const project = projectPath || this.currentProjectPath || 'default';
    const sessionsByProject = this.getStore().get('sessionsByProject', {}) as Record<string, SessionData[]>;
    const sessions = sessionsByProject[project] || [];
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
  deleteSession(sessionId: string, projectPath?: string): boolean {
    const project = projectPath || this.currentProjectPath || 'default';
    const sessionsByProject = this.getStore().get('sessionsByProject', {}) as Record<string, SessionData[]>;
    const sessions = sessionsByProject[project] || [];

    // Filter out the session to delete
    const updatedSessions = sessions.filter(s => s.id !== sessionId);

    // Update the store
    sessionsByProject[project] = updatedSessions;
    this.getStore().set('sessionsByProject', sessionsByProject);

    // If we deleted the current session, clear it
    if (this.currentSession?.id === sessionId) {
      this.currentSession = null;

      // Clear from current session tracking
      const currentByProject = this.getStore().get('currentSessionByProject', {}) as Record<string, string>;
      if (currentByProject[project] === sessionId) {
        delete currentByProject[project];
        this.getStore().set('currentSessionByProject', currentByProject);
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
    const project = session.projectPath || this.currentProjectPath || 'default';
    const sessionsByProject = this.getStore().get('sessionsByProject', {}) as Record<string, SessionData[]>;
    
    if (!sessionsByProject[project]) {
      sessionsByProject[project] = [];
    }
    
    const sessions = sessionsByProject[project];
    const index = sessions.findIndex(s => s.id === session.id);
    
    if (index >= 0) {
      sessions[index] = session;
    } else {
      sessions.push(session);
    }
    
    // Keep only last 50 sessions per project
    if (sessions.length > 50) {
      sessions.splice(0, sessions.length - 50);
    }
    
    sessionsByProject[project] = sessions;
    this.getStore().set('sessionsByProject', sessionsByProject);
  }

  /**
   * Clean up empty messages from all sessions
   */
  cleanupAllSessions(): number {
    const sessionsByProject = this.getStore().get('sessionsByProject', {}) as Record<string, SessionData[]>;
    let totalCleaned = 0;
    
    for (const project in sessionsByProject) {
      const sessions = sessionsByProject[project];
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
          console.log(`[SessionManager] Cleaned ${cleaned} empty messages from session ${session.id} in project ${project}`);
        }
      }
    }
    
    if (totalCleaned > 0) {
      this.getStore().set('sessionsByProject', sessionsByProject);
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