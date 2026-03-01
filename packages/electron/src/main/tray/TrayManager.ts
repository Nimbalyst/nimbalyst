/**
 * TrayManager - System tray icon and menu for AI session status
 *
 * Provides at-a-glance visibility into AI session state from the macOS menu bar.
 * Subscribes to SessionStateManager events for real-time updates and listens
 * to prompt events from AIService for blocked state detection.
 *
 * Icon states (priority order): Error > Needs Attention > Running > Idle
 */

import { Tray, Menu, app, nativeImage, nativeTheme, BrowserWindow } from 'electron';
import { getSessionStateManager } from '@nimbalyst/runtime/ai/server/SessionStateManager';
import type { SessionStateEvent } from '@nimbalyst/runtime/ai/server/types/SessionState';
import { findWindowByWorkspace } from '../window/WindowManager';
import { isShowTrayIcon, setShowTrayIcon } from '../utils/store';
import { logger } from '../utils/logger';

// ─── Types ──────────────────────────────────────────────────────────────────

type TrayIconState = 'idle' | 'running' | 'attention' | 'error';

interface TraySessionInfo {
  sessionId: string;
  title: string;
  workspacePath: string;
  status: 'running' | 'idle' | 'error' | 'interrupted' | 'completed';
  isStreaming: boolean;
  hasPendingPrompt: boolean;
  hasUnread: boolean;
  /** Timestamp when session completed, used for lingering display */
  completedAt?: number;
}

// ─── Database interface (same as SessionStateManager) ───────────────────────

interface DatabaseWorker {
  query<T = any>(sql: string, params?: any[]): Promise<{ rows: T[] }>;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const MENU_REBUILD_DEBOUNCE_MS = 300;
const COMPLETED_LINGER_MS = 60_000; // Keep completed sessions visible for 1 minute

// ─── TrayManager ────────────────────────────────────────────────────────────

export class TrayManager {
  private static instance: TrayManager;

  private tray: Tray | null = null;
  private sessionCache: Map<string, TraySessionInfo> = new Map();
  private stateUnsubscribe: (() => void) | null = null;
  private menuRebuildTimer: NodeJS.Timeout | null = null;
  private lingerTimers: Map<string, NodeJS.Timeout> = new Map();
  private database: DatabaseWorker | null = null;
  private themeListener: (() => void) | null = null;

  private constructor() {}

  static getInstance(): TrayManager {
    if (!TrayManager.instance) {
      TrayManager.instance = new TrayManager();
    }
    return TrayManager.instance;
  }

  /**
   * Set the database worker for querying session metadata.
   * Must be called before initialize().
   */
  setDatabase(database: DatabaseWorker): void {
    this.database = database;
  }

  /**
   * Initialize the tray icon and subscribe to session state events.
   * Throws if SessionStateManager is not available (fail fast).
   */
  async initialize(): Promise<void> {
    // Skip in Playwright tests -- the tray is not useful in test environments
    if (process.env.PLAYWRIGHT) {
      logger.main.info('[TrayManager] Skipping initialization in Playwright mode');
      return;
    }

    // macOS only for initial implementation
    if (process.platform !== 'darwin') {
      logger.main.info('[TrayManager] Skipping initialization on non-macOS platform');
      return;
    }

    const manager = getSessionStateManager();
    if (!manager) {
      throw new Error('[TrayManager] SessionStateManager is not initialized -- cannot create tray without session data source');
    }

    // Always subscribe to session state events so cache stays warm
    this.stateUnsubscribe = manager.subscribe((event: SessionStateEvent) => {
      this.onSessionStateEvent(event);
    });

    // Re-render icon when system theme changes (needed for non-template icons with blue dots)
    const onThemeUpdated = () => this.updateIcon();
    nativeTheme.on('updated', onThemeUpdated);
    this.themeListener = () => nativeTheme.removeListener('updated', onThemeUpdated);

    // Create the tray if setting is enabled (default: true)
    if (isShowTrayIcon()) {
      this.createTray();
    }

    logger.main.info('[TrayManager] Initialized');
  }

  /**
   * Show or hide the tray icon. Persists the preference.
   */
  setVisible(visible: boolean): void {
    setShowTrayIcon(visible);
    if (visible) {
      if (!this.tray) {
        this.createTray();
      }
    } else {
      this.destroyTray();
    }
  }

  private createTray(): void {
    if (this.tray) return;
    const icon = this.getIconForState('idle');
    this.tray = new Tray(icon);
    this.tray.setToolTip('Nimbalyst');
    this.rebuildMenu();
  }

  private destroyTray(): void {
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }
  }

  /**
   * Clean up tray and all subscriptions on app quit.
   */
  shutdown(): void {
    if (this.stateUnsubscribe) {
      this.stateUnsubscribe();
      this.stateUnsubscribe = null;
    }

    if (this.themeListener) {
      this.themeListener();
      this.themeListener = null;
    }

    if (this.menuRebuildTimer) {
      clearTimeout(this.menuRebuildTimer);
      this.menuRebuildTimer = null;
    }

    for (const timer of this.lingerTimers.values()) {
      clearTimeout(timer);
    }
    this.lingerTimers.clear();

    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }

    this.sessionCache.clear();
    logger.main.info('[TrayManager] Shutdown');
  }

  // ─── Prompt state tracking (called from AIService) ──────────────────────

  /**
   * Mark a session as having a pending interactive prompt (blocked on user input).
   * Called from AIService when askUserQuestion, toolPermission, exitPlanMode,
   * or gitCommitProposal events fire.
   */
  onPromptCreated(sessionId: string): void {
    const session = this.sessionCache.get(sessionId);
    if (session) {
      session.hasPendingPrompt = true;
      this.scheduleMenuRebuild();
    }
  }

  /**
   * Clear the pending prompt flag when the user responds.
   */
  onPromptResolved(sessionId: string): void {
    const session = this.sessionCache.get(sessionId);
    if (session) {
      session.hasPendingPrompt = false;
      this.scheduleMenuRebuild();
    }
  }

  /**
   * Mark a session as having unread messages.
   * Called when a session completes while the app is backgrounded.
   */
  onSessionUnread(sessionId: string, hasUnread: boolean): void {
    const session = this.sessionCache.get(sessionId);
    if (session) {
      session.hasUnread = hasUnread;
      this.scheduleMenuRebuild();
    }
  }

  // ─── Session state event handling ───────────────────────────────────────

  private async onSessionStateEvent(event: SessionStateEvent): Promise<void> {
    switch (event.type) {
      case 'session:started':
      case 'session:streaming': {
        // Ensure session is in cache, fetch metadata if needed
        let session = this.sessionCache.get(event.sessionId);
        if (!session) {
          session = await this.fetchSessionMetadata(event.sessionId);
          this.sessionCache.set(event.sessionId, session);
        }
        session.status = 'running';
        session.isStreaming = event.type === 'session:streaming';
        // Clear any linger timer if session restarts
        this.clearLingerTimer(event.sessionId);
        break;
      }

      case 'session:completed': {
        const session = this.sessionCache.get(event.sessionId);
        if (session) {
          session.status = 'completed';
          session.isStreaming = false;
          session.completedAt = Date.now();

          // Check if app is backgrounded -- if so, mark as unread
          const allWindows = BrowserWindow.getAllWindows();
          const hasVisibleFocusedWindow = allWindows.some(w => w.isVisible() && w.isFocused());
          if (!hasVisibleFocusedWindow) {
            session.hasUnread = true;
          }

          // Start linger timer -- remove from cache after COMPLETED_LINGER_MS
          this.startLingerTimer(event.sessionId);
        }
        break;
      }

      case 'session:error': {
        const session = this.sessionCache.get(event.sessionId);
        if (session) {
          session.status = 'error';
          session.isStreaming = false;
        }
        break;
      }

      case 'session:interrupted': {
        // Remove immediately -- interrupted sessions don't need tray visibility
        this.sessionCache.delete(event.sessionId);
        this.clearLingerTimer(event.sessionId);
        break;
      }

      case 'session:waiting': {
        const session = this.sessionCache.get(event.sessionId);
        if (session) {
          session.status = 'running';
          session.isStreaming = false;
        }
        break;
      }

      case 'session:activity': {
        // Activity events don't change tray state, skip rebuild
        return;
      }
    }

    this.scheduleMenuRebuild();
  }

  // ─── Menu item dot icons ────────────────────────────────────────────────

  /** Cached dot icons (created once, reused across menu rebuilds) */
  private dotIconCache: Map<string, Electron.NativeImage> = new Map();

  /**
   * Create a small colored dot NativeImage for use as a menu item icon.
   * macOS renders these at 16x16 in menus; we draw at @2x (32x32) for retina.
   */
  private getDotIcon(hex: string): Electron.NativeImage {
    const cached = this.dotIconCache.get(hex);
    if (cached) return cached;

    const size = 32;
    const canvas = Buffer.alloc(size * size * 4, 0);

    // Parse hex color
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);

    // Draw a filled circle centered at (16, 16) with radius 5
    const cx = 16, cy = 16, radius = 5;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = x - cx, dy = y - cy;
        if (dx * dx + dy * dy <= radius * radius) {
          const offset = (y * size + x) * 4;
          canvas[offset] = r;
          canvas[offset + 1] = g;
          canvas[offset + 2] = b;
          canvas[offset + 3] = 255;
        }
      }
    }

    const image = nativeImage.createFromBuffer(canvas, {
      width: size,
      height: size,
      scaleFactor: 2.0,
    });
    this.dotIconCache.set(hex, image);
    return image;
  }

  // ─── Menu building ──────────────────────────────────────────────────────

  private scheduleMenuRebuild(): void {
    if (this.menuRebuildTimer) {
      clearTimeout(this.menuRebuildTimer);
    }
    this.menuRebuildTimer = setTimeout(() => {
      this.menuRebuildTimer = null;
      this.rebuildMenu();
    }, MENU_REBUILD_DEBOUNCE_MS);
  }

  private rebuildMenu(): void {
    if (!this.tray) return;

    const needsAttention: TraySessionInfo[] = [];
    const running: TraySessionInfo[] = [];
    const unread: TraySessionInfo[] = [];

    for (const session of this.sessionCache.values()) {
      if (session.hasPendingPrompt || session.status === 'error') {
        needsAttention.push(session);
      } else if (session.status === 'running') {
        running.push(session);
      } else if (session.hasUnread) {
        unread.push(session);
      }
    }

    const menuItems: Electron.MenuItemConstructorOptions[] = [];

    const blueDot = this.getDotIcon('#3B82F6');
    const orangeDot = this.getDotIcon('#F97316');
    const redDot = this.getDotIcon('#EF4444');

    // Needs Attention section
    if (needsAttention.length > 0) {
      menuItems.push({ label: 'Needs Attention', enabled: false });
      for (const session of needsAttention) {
        const isError = session.status === 'error';
        const suffix = isError ? ' (error)' : ' (blocked)';
        menuItems.push({
          label: this.truncateTitle(session.title) + suffix,
          icon: isError ? redDot : orangeDot,
          click: () => this.handleSessionClick(session.sessionId, session.workspacePath),
        });
      }
      menuItems.push({ type: 'separator' });
    }

    // Running section
    if (running.length > 0) {
      menuItems.push({ label: 'Running', enabled: false });
      for (const session of running) {
        const suffix = session.isStreaming ? ' (streaming...)' : '';
        menuItems.push({
          label: this.truncateTitle(session.title) + suffix,
          click: () => this.handleSessionClick(session.sessionId, session.workspacePath),
        });
      }
      menuItems.push({ type: 'separator' });
    }

    // Unread section
    if (unread.length > 0) {
      menuItems.push({ label: 'Unread', enabled: false });
      for (const session of unread) {
        menuItems.push({
          label: this.truncateTitle(session.title),
          icon: blueDot,
          click: () => this.handleSessionClick(session.sessionId, session.workspacePath),
        });
      }
      menuItems.push({ type: 'separator' });
    }

    // Always show these items
    menuItems.push({
      label: 'New Session',
      click: () => this.handleNewSession(),
    });
    menuItems.push({
      label: 'Open Nimbalyst',
      click: () => {
        const windows = BrowserWindow.getAllWindows();
        if (windows.length > 0) {
          windows[0].show();
          windows[0].focus();
        }
      },
    });
    menuItems.push({
      label: 'Hide Menu Bar Icon',
      click: () => this.setVisible(false),
    });
    menuItems.push({ type: 'separator' });
    menuItems.push({
      label: 'Quit',
      click: () => app.quit(),
    });

    const menu = Menu.buildFromTemplate(menuItems);
    this.tray.setContextMenu(menu);

    // Update icon state
    this.updateIcon();

    // Update dock badge
    this.updateDockBadge(needsAttention.length);
  }

  // ─── Icon management ───────────────────────────────────────────────────

  private updateIcon(): void {
    if (!this.tray) return;

    const state = this.computeIconState();
    const icon = this.getIconForState(state);
    this.tray.setImage(icon);

    // Update title text on macOS (shown next to the icon)
    const runningCount = this.getRunningCount();
    const attentionCount = this.getAttentionCount();
    if (attentionCount > 0) {
      this.tray.setTitle(` ${attentionCount}`);
    } else if (runningCount > 0) {
      this.tray.setTitle(` ${runningCount}`);
    } else {
      this.tray.setTitle('');
    }
  }

  private computeIconState(): TrayIconState {
    let hasError = false;
    let hasAttention = false;
    let hasRunning = false;

    for (const session of this.sessionCache.values()) {
      if (session.status === 'error') hasError = true;
      if (session.hasPendingPrompt || session.hasUnread) hasAttention = true;
      if (session.status === 'running') hasRunning = true;
    }

    // Priority order: Error > Needs Attention > Running > Idle
    if (hasError) return 'error';
    if (hasAttention) return 'attention';
    if (hasRunning) return 'running';
    return 'idle';
  }

  private getIconForState(state: TrayIconState): Electron.NativeImage {
    // 32x32 pixel buffer at @2x scale = 16pt icon on retina displays
    const size = 32;
    const canvas = Buffer.alloc(size * size * 4, 0); // RGBA
    const cx = 16, cy = 16;

    // Attention/error states need a blue dot, which requires explicit color.
    // Template images are monochrome (macOS tints them automatically).
    // Non-template images need us to pick the right foreground color.
    const needsColorDot = state === 'attention' || state === 'error';
    const isDarkMenuBar = nativeTheme.shouldUseDarkColors;

    // Icon foreground color
    let fgR = 0, fgG = 0, fgB = 0; // Black for template images
    if (needsColorDot) {
      // Non-template: adapt foreground to menu bar appearance
      if (isDarkMenuBar) { fgR = 255; fgG = 255; fgB = 255; }
    }

    const setPixel = (x: number, y: number, r: number, g: number, b: number, a: number) => {
      if (x < 0 || x >= size || y < 0 || y >= size) return;
      const offset = (y * size + x) * 4;
      canvas[offset] = r;
      canvas[offset + 1] = g;
      canvas[offset + 2] = b;
      canvas[offset + 3] = a;
    };

    const setFgPixel = (x: number, y: number, a: number) => {
      setPixel(x, y, fgR, fgG, fgB, a);
    };

    // ── Splat/blob outline ────────────────────────────────────────────
    // Irregular boundary using sinusoidal radius variation (5 lobes)
    // Creates the Nimbalyst "splat" silhouette
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = x - cx, dy = y - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const angle = Math.atan2(dy, dx);
        // 5-lobed boundary with secondary wobble for organic feel
        const boundary = 11.5 + 2.2 * Math.sin(5 * angle + 0.4) + 0.8 * Math.sin(3 * angle - 0.7);

        // Draw outline (1.4px thick ring)
        if (Math.abs(dist - boundary) < 1.4) {
          setFgPixel(x, y, 210);
        }
      }
    }

    // ── # hash mark ──────────────────────────────────────────────────
    const drawRect = (rx: number, ry: number, w: number, h: number, alpha: number) => {
      for (let dy = 0; dy < h; dy++) {
        for (let dx = 0; dx < w; dx++) {
          setFgPixel(rx + dx, ry + dy, alpha);
        }
      }
    };

    if (state === 'running') {
      // Bolder # for running state
      drawRect(cx - 5, cy - 5, 3, 10, 230);
      drawRect(cx + 2, cy - 5, 3, 10, 230);
      drawRect(cx - 6, cy - 3, 12, 3, 230);
      drawRect(cx - 6, cy + 1, 12, 3, 230);
    } else {
      // Normal weight #
      drawRect(cx - 4, cy - 5, 2, 10, 220);
      drawRect(cx + 2, cy - 5, 2, 10, 220);
      drawRect(cx - 6, cy - 2, 12, 2, 220);
      drawRect(cx - 6, cy + 1, 12, 2, 220);
    }

    // ── Blue dot indicator ───────────────────────────────────────────
    if (needsColorDot) {
      const dotCx = 25, dotCy = 25, dotR = 4;
      for (let dy = -dotR; dy <= dotR; dy++) {
        for (let dx = -dotR; dx <= dotR; dx++) {
          if (dx * dx + dy * dy <= dotR * dotR) {
            // Nimbalyst primary blue: #3B82F6
            setPixel(dotCx + dx, dotCy + dy, 59, 130, 246, 255);
          }
        }
      }
    }

    const image = nativeImage.createFromBuffer(canvas, {
      width: size,
      height: size,
      scaleFactor: 2.0,
    });

    // Template images auto-adapt to dark/light menu bar (monochrome only).
    // Non-template for states with colored elements (blue dot).
    image.setTemplateImage(!needsColorDot);

    return image;
  }

  // ─── Dock badge ────────────────────────────────────────────────────────

  private updateDockBadge(attentionCount: number): void {
    if (process.platform === 'darwin' && app.dock) {
      app.dock.setBadge(attentionCount > 0 ? String(attentionCount) : '');
    }
  }

  // ─── Session click handling ────────────────────────────────────────────

  private handleNewSession(): void {
    const windows = BrowserWindow.getAllWindows();
    if (windows.length > 0) {
      const win = windows[0];
      win.show();
      win.focus();
      // Tell renderer to switch to agent mode and create a new session
      win.webContents.send('tray:new-session');
    }
  }

  private handleSessionClick(sessionId: string, workspacePath: string): void {
    if (!workspacePath) {
      throw new Error(`[TrayManager] workspacePath is missing for session ${sessionId} -- cache bug`);
    }

    const targetWindow = findWindowByWorkspace(workspacePath);
    if (targetWindow && !targetWindow.isDestroyed()) {
      targetWindow.show();
      targetWindow.focus();
      // Send navigation request to renderer
      targetWindow.webContents.send('tray:navigate-to-session', { sessionId, workspacePath });
    } else {
      // No window for this workspace -- just show any window
      const windows = BrowserWindow.getAllWindows();
      if (windows.length > 0) {
        windows[0].show();
        windows[0].focus();
      }
    }

    // Clear unread flag when user clicks
    const session = this.sessionCache.get(sessionId);
    if (session) {
      session.hasUnread = false;
      this.scheduleMenuRebuild();
    }
  }

  // ─── Database queries ─────────────────────────────────────────────────

  private async fetchSessionMetadata(sessionId: string): Promise<TraySessionInfo> {
    if (!this.database) {
      return this.createFallbackSession(sessionId);
    }

    try {
      const { rows } = await this.database.query<any>(
        `SELECT id, title, workspace_id, metadata FROM ai_sessions WHERE id = $1`,
        [sessionId]
      );

      if (rows.length === 0) {
        return this.createFallbackSession(sessionId);
      }

      const row = rows[0];
      const metadata = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : (row.metadata || {});

      return {
        sessionId,
        title: row.title || 'Untitled Session',
        workspacePath: row.workspace_id || '',
        status: 'running',
        isStreaming: false,
        hasPendingPrompt: !!metadata.pendingAskUserQuestion,
        hasUnread: !!metadata.hasUnread,
      };
    } catch (error) {
      // Database query failure is not fatal -- title is cosmetic
      logger.main.error(`[TrayManager] Failed to fetch session metadata for ${sessionId}:`, error);
      return this.createFallbackSession(sessionId);
    }
  }

  private createFallbackSession(sessionId: string): TraySessionInfo {
    return {
      sessionId,
      title: 'AI Session',
      workspacePath: '',
      status: 'running',
      isStreaming: false,
      hasPendingPrompt: false,
      hasUnread: false,
    };
  }

  // ─── Helpers ──────────────────────────────────────────────────────────

  private truncateTitle(title: string, maxLen: number = 40): string {
    if (title.length <= maxLen) return title;
    return title.slice(0, maxLen - 1) + '\u2026';
  }

  private getRunningCount(): number {
    let count = 0;
    for (const session of this.sessionCache.values()) {
      if (session.status === 'running') count++;
    }
    return count;
  }

  private getAttentionCount(): number {
    let count = 0;
    for (const session of this.sessionCache.values()) {
      if (session.hasPendingPrompt || session.hasUnread || session.status === 'error') count++;
    }
    return count;
  }

  private startLingerTimer(sessionId: string): void {
    this.clearLingerTimer(sessionId);
    const timer = setTimeout(() => {
      this.lingerTimers.delete(sessionId);
      const session = this.sessionCache.get(sessionId);
      // Only remove if still in completed state and not unread
      if (session && session.status === 'completed' && !session.hasUnread && !session.hasPendingPrompt) {
        this.sessionCache.delete(sessionId);
        this.scheduleMenuRebuild();
      }
    }, COMPLETED_LINGER_MS);
    this.lingerTimers.set(sessionId, timer);
  }

  private clearLingerTimer(sessionId: string): void {
    const timer = this.lingerTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.lingerTimers.delete(sessionId);
    }
  }
}
