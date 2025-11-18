import { BrowserWindow } from 'electron';
import { SessionManager, ClaudeCodeProvider } from '@nimbalyst/runtime/ai/server';
import {
  startSessionNamingServer,
  setUpdateSessionTitleFn,
  shutdownSessionNamingHttpServer
} from '../mcp/sessionNamingServer';

/**
 * Service to manage the session naming MCP server
 * This runs in the electron main process and coordinates with ClaudeCodeProvider
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
   * Start the session naming MCP server and configure ClaudeCodeProvider
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
          // Update the session title in the database (atomic check-and-set)
          await sessionManager.updateSessionTitle(sessionId, title);

          // Notify all windows that the session title has changed
          const windows = BrowserWindow.getAllWindows();
          for (const window of windows) {
            window.webContents.send('session:title-updated', { sessionId, title });
          }

          console.log(`[SessionNamingService] Updated session ${sessionId} to: "${title}"`);
        });

        // Start the MCP server
        const { port } = await startSessionNamingServer();
        this.serverPort = port;
        console.log(`[SessionNamingService] MCP server started on port ${port}`);

        // Inject the port into ClaudeCodeProvider so it can configure the MCP server
        ClaudeCodeProvider.setSessionNamingServerPort(port);

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
      this.serverPort = null;
      this.started = false;
      console.log('[SessionNamingService] Shutdown complete');
    } catch (error) {
      console.error('[SessionNamingService] Error during shutdown:', error);
    }
  }

}
