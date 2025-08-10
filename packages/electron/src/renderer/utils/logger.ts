/**
 * Configurable logging system with categories
 * Allows enabling/disabling specific log categories to reduce noise
 */

export type LogCategory = 
  | 'streaming'      // Streaming content to editor
  | 'api'           // Claude API calls
  | 'session'       // Session management
  | 'ui'            // UI events and rendering
  | 'editor'        // Editor content changes
  | 'file'          // File operations
  | 'bridge'        // AI Chat Bridge communication
  | 'protocol'      // Stream protocol parsing
  | 'autosave'      // Autosave operations
  | 'general';      // General logs

interface LogConfig {
  enabled: boolean;
  color?: string;
  prefix?: string;
}

class Logger {
  private categories: Map<LogCategory, LogConfig> = new Map();
  private globalEnabled: boolean = true;

  constructor() {
    // Initialize default categories
    this.initializeCategories();
    
    // Load saved preferences from localStorage
    this.loadPreferences();
    
    // Expose to window for easy runtime configuration
    (window as any).logger = this;
  }

  private initializeCategories() {
    // Set default configurations for each category
    const defaults: Record<LogCategory, LogConfig> = {
      streaming: { enabled: true, color: '#00a8ff', prefix: '🔄' },
      api: { enabled: true, color: '#ff6b6b', prefix: '🌐' },
      session: { enabled: true, color: '#4ecdc4', prefix: '📋' },
      ui: { enabled: false, color: '#95e1d3', prefix: '🎨' },  // Disabled by default (noisy)
      editor: { enabled: false, color: '#f38181', prefix: '📝' },  // Disabled by default (noisy)
      file: { enabled: true, color: '#aa96da', prefix: '📁' },
      bridge: { enabled: true, color: '#fcbad3', prefix: '🌉' },
      protocol: { enabled: true, color: '#ffffd2', prefix: '📡' },
      autosave: { enabled: false, color: '#c7ceea', prefix: '💾' },  // Disabled by default (noisy)
      general: { enabled: true, color: '#b2bec3', prefix: '📌' }
    };

    for (const [category, config] of Object.entries(defaults)) {
      this.categories.set(category as LogCategory, config);
    }
  }

  private loadPreferences() {
    try {
      const saved = localStorage.getItem('loggerConfig');
      if (saved) {
        const config = JSON.parse(saved);
        for (const [category, enabled] of Object.entries(config)) {
          const cat = this.categories.get(category as LogCategory);
          if (cat) {
            cat.enabled = enabled as boolean;
          }
        }
      }
    } catch (error) {
      // Ignore errors loading preferences
    }
  }

  private savePreferences() {
    try {
      const config: Record<string, boolean> = {};
      for (const [category, { enabled }] of this.categories) {
        config[category] = enabled;
      }
      localStorage.setItem('loggerConfig', JSON.stringify(config));
    } catch (error) {
      // Ignore errors saving preferences
    }
  }

  public log(category: LogCategory, message: string, ...args: any[]) {
    if (!this.globalEnabled) return;
    
    const config = this.categories.get(category);
    if (!config || !config.enabled) return;

    const prefix = config.prefix || '';
    const label = `[${category.toUpperCase()}]`;
    
    if (config.color) {
      console.log(
        `%c${prefix} ${label}%c ${message}`,
        `color: ${config.color}; font-weight: bold;`,
        'color: inherit;',
        ...args
      );
    } else {
      console.log(`${prefix} ${label} ${message}`, ...args);
    }
  }

  public enable(category: LogCategory) {
    const config = this.categories.get(category);
    if (config) {
      config.enabled = true;
      this.savePreferences();
    }
  }

  public disable(category: LogCategory) {
    const config = this.categories.get(category);
    if (config) {
      config.enabled = false;
      this.savePreferences();
    }
  }

  public enableAll() {
    for (const config of this.categories.values()) {
      config.enabled = true;
    }
    this.savePreferences();
  }

  public disableAll() {
    for (const config of this.categories.values()) {
      config.enabled = false;
    }
    this.savePreferences();
  }

  public enableOnly(...categories: LogCategory[]) {
    // Disable all first
    for (const config of this.categories.values()) {
      config.enabled = false;
    }
    // Then enable specified categories
    for (const category of categories) {
      const config = this.categories.get(category);
      if (config) {
        config.enabled = true;
      }
    }
    this.savePreferences();
  }

  public getStatus(): Record<LogCategory, boolean> {
    const status: Partial<Record<LogCategory, boolean>> = {};
    for (const [category, config] of this.categories) {
      status[category] = config.enabled;
    }
    return status as Record<LogCategory, boolean>;
  }

  public printStatus() {
    console.log('%c=== Logger Status ===', 'color: #00d2d3; font-weight: bold; font-size: 14px;');
    for (const [category, config] of this.categories) {
      const status = config.enabled ? '✅' : '❌';
      const color = config.enabled ? '#00d2d3' : '#ee5a6f';
      console.log(
        `%c${status} ${category}`,
        `color: ${color}; padding-left: 10px;`
      );
    }
    console.log('%c==================', 'color: #00d2d3; font-weight: bold;');
  }

  // Convenience methods for common debugging scenarios
  public focusOnStreaming() {
    this.enableOnly('streaming', 'bridge', 'protocol', 'api');
    console.log('%c🎯 Focused on streaming logs', 'color: #00a8ff; font-weight: bold;');
  }

  public focusOnSessions() {
    this.enableOnly('session', 'api');
    console.log('%c🎯 Focused on session logs', 'color: #4ecdc4; font-weight: bold;');
  }

  public focusOnFiles() {
    this.enableOnly('file', 'autosave');
    console.log('%c🎯 Focused on file logs', 'color: #aa96da; font-weight: bold;');
  }

  public quiet() {
    this.enableOnly('general');
    console.log('%c🤫 Quiet mode - only general logs', 'color: #b2bec3; font-weight: bold;');
  }
}

// Create singleton instance
export const logger = new Logger();

// Print initial status and instructions
if (typeof window !== 'undefined') {
  console.log('%c📊 Logger initialized. Use window.logger to configure.', 'color: #00d2d3; font-weight: bold;');
  console.log('Commands: logger.printStatus(), logger.enable("category"), logger.disable("category")');
  console.log('Quick modes: logger.focusOnStreaming(), logger.focusOnSessions(), logger.quiet()');
}