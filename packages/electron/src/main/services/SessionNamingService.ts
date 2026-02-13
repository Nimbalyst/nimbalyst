import { BrowserWindow } from 'electron';
import { SessionManager, ClaudeCodeProvider, OpenAICodexProvider } from '@nimbalyst/runtime/ai/server';
import { AISessionsRepository } from '@nimbalyst/runtime';
import {
  startSessionNamingServer,
  setUpdateSessionTitleFn,
  shutdownSessionNamingHttpServer
} from '../mcp/sessionNamingServer';
import { getDatabase } from '../database/initialize';
import { createWorktreeStore } from './WorktreeStore';
import { createBlitzStore } from './BlitzStore';

/**
 * Service to manage the session naming MCP server
 * This runs in the electron main process and coordinates with agent providers
 */
export class SessionNamingService {
  private static instance: SessionNamingService | null = null;
  private serverPort: number | null = null;
  private starting: Promise<void> | null = null;
  private started: boolean = false;
  private sessionManager: SessionManager | null = null;

  private constructor() {}

  public static getInstance(): SessionNamingService {
    if (!SessionNamingService.instance) {
      SessionNamingService.instance = new SessionNamingService();
    }
    return SessionNamingService.instance;
  }

  /**
   * Start the session naming MCP server and configure agent providers
   */
  public async start(): Promise<void> {
    // If already started, do nothing
    if (this.started) {
      return;
    }

    // If already starting, wait for it
    if (this.starting) {
      await this.starting;
      return;
    }

    this.starting = (async () => {
      try {
        // Initialize session manager
        this.sessionManager = new SessionManager();
        await this.sessionManager.initialize();

        // Set the update function that will be called by the MCP server
        // This is called once at startup and captures sessionManager in the closure
        const sessionManager = this.sessionManager;
        setUpdateSessionTitleFn(async (sessionId: string, title: string) => {
          const windows = BrowserWindow.getAllWindows();

          // Check if this session belongs to a blitz worktree before updating the session title.
          // For blitz sessions, we keep the numbered title (e.g. "Session 1") and only
          // propagate the name to the worktree and blitz display names.
          let isBlitzSession = false;
          let worktreeId: string | undefined;
          let blitzId: string | undefined;

          try {
            const session = await AISessionsRepository.get(sessionId);
            if (session?.worktreeId) {
              worktreeId = session.worktreeId;
              const db = getDatabase();
              if (db) {
                const worktreeStore = createWorktreeStore(db);
                const worktree = await worktreeStore.get(session.worktreeId);
                if (worktree?.blitzId) {
                  isBlitzSession = true;
                  blitzId = worktree.blitzId;
                }
              }
            }
          } catch (error) {
            console.error('[SessionNamingService] Failed to check blitz membership:', error);
          }

          if (!isBlitzSession) {
            // Non-blitz session: update the session title as usual
            await sessionManager.updateSessionTitle(sessionId, title);
            for (const window of windows) {
              window.webContents.send('session:title-updated', { sessionId, title });
            }
          }

          // Propagate to worktree and blitz display names regardless
          if (worktreeId) {
            try {
              const db = getDatabase();
              if (db) {
                const worktreeStore = createWorktreeStore(db);
                const updated = await worktreeStore.updateDisplayNameIfEmpty(worktreeId, title);
                if (updated) {
                  console.log(`[SessionNamingService] Updated worktree ${worktreeId} display name to: "${title}"`);
                  for (const window of windows) {
                    window.webContents.send('worktree:display-name-updated', {
                      worktreeId,
                      displayName: title
                    });
                  }
                }

                if (blitzId) {
                  const blitzStore = createBlitzStore(db);
                  const blitzUpdated = await blitzStore.updateDisplayNameIfEmpty(blitzId, title);
                  if (blitzUpdated) {
                    console.log(`[SessionNamingService] Updated blitz ${blitzId} display name to: "${title}"`);
                    for (const window of windows) {
                      window.webContents.send('blitz:display-name-updated', {
                        blitzId,
                        displayName: title
                      });
                    }
                  }
                }
              }
            } catch (error) {
              console.error('[SessionNamingService] Failed to update worktree/blitz display name:', error);
            }
          }
        });

        // Start the MCP server
        const { port } = await startSessionNamingServer();
        this.serverPort = port;
        console.log(`[SessionNamingService] MCP server started on port ${port}`);

        // Inject the port into agent providers so they can configure the MCP server
        ClaudeCodeProvider.setSessionNamingServerPort(port);
        OpenAICodexProvider.setSessionNamingServerPort(port);

        this.started = true;
      } catch (error) {
        console.error('[SessionNamingService] Failed to start:', error);
        throw error;
      } finally {
        this.starting = null;
      }
    })();

    await this.starting;
  }

  /**
   * Shutdown the session naming MCP server
   */
  public async shutdown(): Promise<void> {
    if (!this.started) {
      return;
    }

    try {
      await shutdownSessionNamingHttpServer();
      ClaudeCodeProvider.setSessionNamingServerPort(null);
      OpenAICodexProvider.setSessionNamingServerPort(null);
      this.serverPort = null;
      this.started = false;
      console.log('[SessionNamingService] Shutdown complete');
    } catch (error) {
      console.error('[SessionNamingService] Error during shutdown:', error);
    }
  }

}
