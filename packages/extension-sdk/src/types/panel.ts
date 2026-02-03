/**
 * Panel Types for Nimbalyst Extensions
 *
 * Panels are non-file-based UIs that extensions can contribute to Nimbalyst.
 * Unlike custom editors (which are tied to file types), panels provide
 * persistent interfaces for things like database browsers, deployment
 * dashboards, home automation controls, etc.
 *
 * Panels integrate with:
 * - Navigation gutter (sidebar/fullscreen buttons)
 * - AI tools (shared state between UI and agent)
 * - Extension storage (namespaced configuration persistence)
 */

import type { ComponentType } from 'react';

// ============================================================================
// Panel Contribution Types (for manifest.json)
// ============================================================================

/**
 * Panel contribution declared in manifest.json.
 *
 * @example
 * ```json
 * {
 *   "contributions": {
 *     "panels": [{
 *       "id": "database-browser",
 *       "title": "Database",
 *       "icon": "database",
 *       "placement": "sidebar",
 *       "aiSupported": true
 *     }]
 *   }
 * }
 * ```
 */
export interface PanelContribution {
  /**
   * Unique identifier within the extension.
   * Full panel ID will be `${extensionId}.${id}`.
   */
  id: string;

  /**
   * Display title shown in gutter tooltip and panel header.
   */
  title: string;

  /**
   * Icon for the gutter button.
   * Can be a Material icon name (e.g., "database"), emoji, or relative path to icon file.
   */
  icon: string;

  /**
   * Where and how the panel is displayed.
   *
   * - `"sidebar"`: Panel appears in the sidebar area, alongside or replacing the file tree.
   *   Extension gets a gutter button in the middle section.
   *
   * - `"fullscreen"`: Panel takes over the entire main content area.
   *   Extension gets a gutter button that switches to this mode.
   *
   * - `"floating"`: Panel renders at app level (like modals/popovers).
   *   No gutter button - extension controls visibility via callbacks.
   */
  placement: 'sidebar' | 'fullscreen' | 'floating';

  /**
   * Whether this panel exposes AI tools that share state with the UI.
   * When true, the panel receives a PanelAIContext for coordinating with AI tools.
   * @default false
   */
  aiSupported?: boolean;

  /**
   * When to activate this panel.
   *
   * - `"onStartup"`: Activate when extension loads
   * - `"onPanel"`: Activate when panel is first opened (default)
   * - `"onCommand:xyz"`: Activate when command xyz is invoked
   *
   * @default ["onPanel"]
   */
  activationEvents?: string[];

  /**
   * Sort order for gutter buttons.
   * Lower numbers appear higher/earlier.
   * @default 100
   */
  order?: number;
}

/**
 * Settings panel contribution for the Settings screen.
 *
 * @example
 * ```json
 * {
 *   "contributions": {
 *     "settingsPanel": {
 *       "component": "DatabaseSettings",
 *       "title": "Database Connections",
 *       "icon": "database"
 *     }
 *   }
 * }
 * ```
 */
export interface SettingsPanelContribution {
  /**
   * Name of the exported component from the extension module.
   */
  component: string;

  /**
   * Title shown in the Settings sidebar.
   */
  title: string;

  /**
   * Icon for the Settings sidebar.
   */
  icon?: string;

  /**
   * Sort order in the Extensions settings section.
   * @default 100
   */
  order?: number;
}

// ============================================================================
// Panel Module Exports (what extensions export)
// ============================================================================

/**
 * Panel export from extension module.
 *
 * @example
 * ```typescript
 * export const panels = {
 *   'database-browser': {
 *     component: DatabaseBrowserPanel,
 *     settingsComponent: DatabaseQuickSettings,
 *   }
 * };
 * ```
 */
export interface PanelExport {
  /**
   * Main panel component.
   * Receives PanelHostProps.
   */
  component: ComponentType<PanelHostProps>;

  /**
   * Optional custom gutter button component.
   * Receives PanelGutterButtonProps.
   * If not provided, a default button with the icon is used.
   */
  gutterButton?: ComponentType<PanelGutterButtonProps>;

  /**
   * Optional quick settings component rendered in the panel header.
   * Receives PanelHostProps (same as main component).
   */
  settingsComponent?: ComponentType<PanelHostProps>;
}

// ============================================================================
// PanelHost Interface (what panels receive)
// ============================================================================

/**
 * Props passed to panel components.
 */
export interface PanelHostProps {
  /**
   * Host service for panel-host communication.
   */
  host: PanelHost;
}

/**
 * Props passed to custom gutter button components.
 */
export interface PanelGutterButtonProps {
  /**
   * Whether this panel is currently active/visible.
   */
  isActive: boolean;

  /**
   * Callback to activate/show this panel.
   */
  onActivate: () => void;

  /**
   * Current application theme.
   */
  theme: string;
}

/**
 * Host service for panels.
 *
 * Provides communication between panel and host application.
 * Panels receive this as a prop and use it for navigation, state, and AI coordination.
 */
export interface PanelHost {
  // ============ IDENTITY ============

  /**
   * Full panel ID (extensionId.panelId).
   */
  readonly panelId: string;

  /**
   * Extension that provides this panel.
   */
  readonly extensionId: string;

  // ============ ENVIRONMENT ============

  /**
   * Current application theme.
   */
  readonly theme: string;

  /**
   * Absolute path to current workspace.
   */
  readonly workspacePath: string;

  /**
   * Subscribe to theme changes.
   *
   * @param callback Called with new theme when it changes
   * @returns Unsubscribe function
   */
  onThemeChanged(callback: (theme: string) => void): () => void;

  // ============ NAVIGATION ============

  /**
   * Open a file in the editor.
   *
   * @param path Absolute or workspace-relative path
   */
  openFile(path: string): void;

  /**
   * Switch to another panel.
   *
   * @param panelId Full panel ID (extensionId.panelId) or just panelId for same extension
   */
  openPanel(panelId: string): void;

  /**
   * Close this panel (for floating panels).
   */
  close(): void;

  // ============ SETTINGS TOGGLE ============

  /**
   * Whether the panel's settings view is currently open.
   */
  readonly isSettingsOpen: boolean;

  /**
   * Open the panel's settings view.
   */
  openSettings(): void;

  /**
   * Close the panel's settings view.
   */
  closeSettings(): void;

  // ============ AI CONTEXT ============

  /**
   * AI context for coordinating with AI tools.
   * Only available if panel has `aiSupported: true`.
   */
  readonly ai?: PanelAIContext;

  // ============ STORAGE ============

  /**
   * Namespaced storage for persisting panel state.
   * Automatically scoped to this extension.
   */
  readonly storage: ExtensionStorage;
}

// ============================================================================
// PanelAIContext (AI tool coordination)
// ============================================================================

/**
 * AI context for panels to coordinate with AI tools.
 *
 * Panels use this to share state with AI tools. For example, a database browser
 * panel can expose the active connection so AI tools can query it.
 *
 * @example
 * ```typescript
 * function DatabasePanel({ host }: PanelHostProps) {
 *   const [activeConnection, setActiveConnection] = useState<Connection | null>(null);
 *
 *   useEffect(() => {
 *     // Update AI context when selection changes
 *     host.ai?.setContext({
 *       activeConnection: activeConnection?.name,
 *       database: activeConnection?.database,
 *     });
 *   }, [activeConnection, host.ai]);
 *
 *   return <div>...</div>;
 * }
 * ```
 */
export interface PanelAIContext {
  /**
   * Set dynamic context that AI tools can access.
   *
   * This context is available to the extension's AI tool handlers
   * and is included in the tool execution context.
   *
   * @param context Key-value pairs of context data
   */
  setContext(context: Record<string, unknown>): void;

  /**
   * Get the current context.
   */
  getContext(): Record<string, unknown>;

  /**
   * Clear all context.
   */
  clearContext(): void;

  /**
   * Notify that panel state changed.
   *
   * This can be used to trigger proactive AI suggestions or
   * update any subscribers to panel state.
   *
   * @param event Event name (e.g., "queryExecuted", "connectionChanged")
   * @param data Optional event data
   */
  notifyChange(event: string, data?: unknown): void;

  /**
   * Subscribe to context changes from AI tools.
   *
   * AI tools can update context (e.g., to show query results in the panel).
   *
   * @param callback Called when context is updated
   * @returns Unsubscribe function
   */
  onContextChanged(callback: (context: Record<string, unknown>) => void): () => void;
}

// ============================================================================
// Extension Storage Types
// ============================================================================

/**
 * Namespaced storage service for extensions.
 *
 * All keys are automatically namespaced by extension ID.
 * Extensions cannot access each other's storage.
 *
 * @example
 * ```typescript
 * // In extension code:
 * const connections = await storage.getGlobal<Connection[]>('connections') ?? [];
 * await storage.setGlobal('connections', [...connections, newConnection]);
 *
 * // Password stored securely in system keychain
 * await storage.setSecret('conn-123-password', password);
 * ```
 */
export interface ExtensionStorage {
  // ============ WORKSPACE STORAGE ============

  /**
   * Get a value from workspace-scoped storage.
   * Workspace storage is specific to the current project.
   *
   * @param key Storage key (automatically namespaced)
   * @returns The stored value, or undefined if not set
   */
  get<T>(key: string): T | undefined;

  /**
   * Set a value in workspace-scoped storage.
   *
   * @param key Storage key (automatically namespaced)
   * @param value Value to store (must be JSON-serializable)
   */
  set<T>(key: string, value: T): Promise<void>;

  /**
   * Delete a value from workspace-scoped storage.
   *
   * @param key Storage key to delete
   */
  delete(key: string): Promise<void>;

  // ============ GLOBAL STORAGE ============

  /**
   * Get a value from global storage.
   * Global storage is shared across all workspaces.
   *
   * @param key Storage key (automatically namespaced)
   * @returns The stored value, or undefined if not set
   */
  getGlobal<T>(key: string): T | undefined;

  /**
   * Set a value in global storage.
   *
   * @param key Storage key (automatically namespaced)
   * @param value Value to store (must be JSON-serializable)
   */
  setGlobal<T>(key: string, value: T): Promise<void>;

  /**
   * Delete a value from global storage.
   *
   * @param key Storage key to delete
   */
  deleteGlobal(key: string): Promise<void>;

  // ============ SECRET STORAGE ============

  /**
   * Get a secret from secure storage (system keychain).
   * Secrets are never synced or logged.
   *
   * @param key Secret key (automatically namespaced)
   * @returns The secret value, or undefined if not set
   */
  getSecret(key: string): Promise<string | undefined>;

  /**
   * Set a secret in secure storage (system keychain).
   *
   * @param key Secret key (automatically namespaced)
   * @param value Secret value to store
   */
  setSecret(key: string, value: string): Promise<void>;

  /**
   * Delete a secret from secure storage.
   *
   * @param key Secret key to delete
   */
  deleteSecret(key: string): Promise<void>;
}

// ============================================================================
// Loaded Panel Types (internal use)
// ============================================================================

/**
 * A loaded panel instance.
 * Internal type used by the extension system.
 */
export interface LoadedPanel {
  /**
   * Full panel ID (extensionId.panelId).
   */
  id: string;

  /**
   * Extension that provides this panel.
   */
  extensionId: string;

  /**
   * Panel contribution from manifest.
   */
  contribution: PanelContribution;

  /**
   * Panel exports from module.
   */
  exports: PanelExport;

  /**
   * Whether the panel is currently active/visible.
   */
  isActive: boolean;
}

/**
 * A loaded settings panel instance.
 * Internal type used by the extension system.
 */
export interface LoadedSettingsPanel {
  /**
   * Extension that provides this panel.
   */
  extensionId: string;

  /**
   * Settings panel contribution from manifest.
   */
  contribution: SettingsPanelContribution;

  /**
   * Settings panel component.
   */
  component: ComponentType<SettingsPanelProps>;
}

/**
 * Props passed to settings panel components.
 */
export interface SettingsPanelProps {
  /**
   * Extension storage service.
   */
  storage: ExtensionStorage;

  /**
   * Current application theme.
   */
  theme: string;
}
