import log from 'electron-log';
import Store from 'electron-store';
import { app } from 'electron';

// Define component scopes for logging
export enum LogComponent {
  // File operations
  FILE_WATCHER = 'FILE_WATCHER',
  PROJECT_WATCHER = 'PROJECT_WATCHER',
  FILE_OPERATIONS = 'FILE_OPERATIONS',
  FILE_TREE = 'FILE_TREE',
  
  // Window management
  WINDOW = 'WINDOW',
  SESSION = 'SESSION',
  MENU = 'MENU',
  
  // AI services
  AI = 'AI',
  AI_CLAUDE = 'AI_CLAUDE',
  AI_CLAUDE_CODE = 'AI_CLAUDE_CODE',
  AI_LMSTUDIO = 'AI_LMSTUDIO',
  AI_OPENAI = 'AI_OPENAI',
  AI_SESSION = 'AI_SESSION',
  
  // Other services
  MCP = 'MCP',
  IPC = 'IPC',
  THEME = 'THEME',
  STORE = 'STORE',
  
  // General
  MAIN = 'MAIN',
  RENDERER = 'RENDERER',
  DEBUG = 'DEBUG'
}

// Log levels
export enum LogLevel {
  ERROR = 'error',
  WARN = 'warn',
  INFO = 'info',
  VERBOSE = 'verbose',
  DEBUG = 'debug',
  SILLY = 'silly'
}

// Configuration interface
interface LoggerConfig {
  globalLevel: LogLevel;
  fileLogging: boolean;
  consoleLogging: boolean;
  components: {
    [key in LogComponent]?: {
      enabled: boolean;
      level: LogLevel;
    };
  };
}

// Default configuration
const defaultConfig: LoggerConfig = {
  globalLevel: process.env.NODE_ENV === 'development' ? LogLevel.DEBUG : LogLevel.INFO,
  fileLogging: true,
  consoleLogging: true,
  components: {
    // File operations - verbose in dev, less in prod
    [LogComponent.FILE_WATCHER]: {
      enabled: true,
      level: process.env.NODE_ENV === 'development' ? LogLevel.DEBUG : LogLevel.WARN
    },
    [LogComponent.PROJECT_WATCHER]: {
      enabled: true,
      level: process.env.NODE_ENV === 'development' ? LogLevel.DEBUG : LogLevel.WARN
    },
    [LogComponent.FILE_OPERATIONS]: {
      enabled: true,
      level: LogLevel.INFO
    },
    [LogComponent.FILE_TREE]: {
      enabled: true,
      level: LogLevel.INFO
    },
    
    // Window management
    [LogComponent.WINDOW]: {
      enabled: true,
      level: LogLevel.INFO
    },
    [LogComponent.SESSION]: {
      enabled: true,
      level: LogLevel.INFO
    },
    [LogComponent.MENU]: {
      enabled: true,
      level: LogLevel.INFO
    },
    
    // AI services - more verbose for debugging
    [LogComponent.AI]: {
      enabled: true,
      level: LogLevel.INFO
    },
    [LogComponent.AI_CLAUDE]: {
      enabled: true,
      level: LogLevel.DEBUG
    },
    [LogComponent.AI_CLAUDE_CODE]: {
      enabled: true,
      level: LogLevel.DEBUG
    },
    [LogComponent.AI_LMSTUDIO]: {
      enabled: true,
      level: LogLevel.DEBUG
    },
    [LogComponent.AI_OPENAI]: {
      enabled: true,
      level: LogLevel.DEBUG
    },
    [LogComponent.AI_SESSION]: {
      enabled: true,
      level: LogLevel.INFO
    },
    
    // Other services
    [LogComponent.MCP]: {
      enabled: true,
      level: LogLevel.INFO
    },
    [LogComponent.IPC]: {
      enabled: true,
      level: process.env.NODE_ENV === 'development' ? LogLevel.DEBUG : LogLevel.WARN
    },
    [LogComponent.THEME]: {
      enabled: true,
      level: LogLevel.INFO
    },
    [LogComponent.STORE]: {
      enabled: true,
      level: LogLevel.INFO
    },
    
    // General
    [LogComponent.MAIN]: {
      enabled: true,
      level: LogLevel.INFO
    },
    [LogComponent.RENDERER]: {
      enabled: true,
      level: LogLevel.INFO
    },
    [LogComponent.DEBUG]: {
      enabled: process.env.NODE_ENV === 'development',
      level: LogLevel.DEBUG
    }
  }
};

// Store for logger configuration
const store = new Store<{ loggerConfig: LoggerConfig }>({
  name: 'logger-config'
});

// Load configuration from store or use defaults
let config: LoggerConfig = store.get('loggerConfig', defaultConfig);

// Configure electron-log
function configureLogger() {
  // Set log file location
  log.transports.file.resolvePathFn = () => {
    const path = app.getPath('userData');
    return `${path}/logs/main.log`;
  };
  
  // Set file size limit (10MB)
  log.transports.file.maxSize = 10 * 1024 * 1024;
  
  // Enable/disable transports based on config
  log.transports.file.level = config.fileLogging ? config.globalLevel : false;
  log.transports.console.level = config.consoleLogging ? config.globalLevel : false;
  
  // Format for better readability with scope
  log.transports.console.format = '[{level}] [{scope}] [{h}:{i}:{s}.{ms}] {text}';
  log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] [{scope}] {text}';
}

// Create a scoped logger for a component
function createComponentLogger(component: LogComponent) {
  const scope = log.scope(component);
  
  // Create a wrapped logger that checks component configuration
  return {
    error: (message: string, ...args: any[]) => {
      const componentConfig = config.components[component];
      if (componentConfig?.enabled && isLevelEnabled(LogLevel.ERROR, componentConfig.level)) {
        scope.error(message, ...args);
      }
    },
    warn: (message: string, ...args: any[]) => {
      const componentConfig = config.components[component];
      if (componentConfig?.enabled && isLevelEnabled(LogLevel.WARN, componentConfig.level)) {
        scope.warn(message, ...args);
      }
    },
    info: (message: string, ...args: any[]) => {
      const componentConfig = config.components[component];
      if (componentConfig?.enabled && isLevelEnabled(LogLevel.INFO, componentConfig.level)) {
        scope.info(message, ...args);
      }
    },
    verbose: (message: string, ...args: any[]) => {
      const componentConfig = config.components[component];
      if (componentConfig?.enabled && isLevelEnabled(LogLevel.VERBOSE, componentConfig.level)) {
        scope.verbose(message, ...args);
      }
    },
    debug: (message: string, ...args: any[]) => {
      const componentConfig = config.components[component];
      if (componentConfig?.enabled && isLevelEnabled(LogLevel.DEBUG, componentConfig.level)) {
        scope.debug(message, ...args);
      }
    },
    silly: (message: string, ...args: any[]) => {
      const componentConfig = config.components[component];
      if (componentConfig?.enabled && isLevelEnabled(LogLevel.SILLY, componentConfig.level)) {
        scope.silly(message, ...args);
      }
    }
  };
}

// Check if a log level is enabled
function isLevelEnabled(messageLevel: LogLevel, configuredLevel: LogLevel): boolean {
  const levels = [LogLevel.ERROR, LogLevel.WARN, LogLevel.INFO, LogLevel.VERBOSE, LogLevel.DEBUG, LogLevel.SILLY];
  const messageLevelIndex = levels.indexOf(messageLevel);
  const configuredLevelIndex = levels.indexOf(configuredLevel);
  return messageLevelIndex <= configuredLevelIndex;
}

// Initialize logger
configureLogger();

// Export component loggers
export const logger = {
  // File operations
  fileWatcher: createComponentLogger(LogComponent.FILE_WATCHER),
  projectWatcher: createComponentLogger(LogComponent.PROJECT_WATCHER),
  fileOperations: createComponentLogger(LogComponent.FILE_OPERATIONS),
  fileTree: createComponentLogger(LogComponent.FILE_TREE),
  
  // Window management
  window: createComponentLogger(LogComponent.WINDOW),
  session: createComponentLogger(LogComponent.SESSION),
  menu: createComponentLogger(LogComponent.MENU),
  
  // AI services
  ai: createComponentLogger(LogComponent.AI),
  aiClaude: createComponentLogger(LogComponent.AI_CLAUDE),
  aiClaudeCode: createComponentLogger(LogComponent.AI_CLAUDE_CODE),
  aiLMStudio: createComponentLogger(LogComponent.AI_LMSTUDIO),
  aiOpenAI: createComponentLogger(LogComponent.AI_OPENAI),
  aiSession: createComponentLogger(LogComponent.AI_SESSION),
  
  // Other services
  mcp: createComponentLogger(LogComponent.MCP),
  ipc: createComponentLogger(LogComponent.IPC),
  theme: createComponentLogger(LogComponent.THEME),
  store: createComponentLogger(LogComponent.STORE),
  
  // General
  main: createComponentLogger(LogComponent.MAIN),
  renderer: createComponentLogger(LogComponent.RENDERER),
  debug: createComponentLogger(LogComponent.DEBUG)
};

// Export configuration functions
export function updateLoggerConfig(newConfig: Partial<LoggerConfig>) {
  config = { ...config, ...newConfig };
  store.set('loggerConfig', config);
  configureLogger();
}

export function updateComponentConfig(component: LogComponent, enabled: boolean, level?: LogLevel) {
  if (!config.components[component]) {
    config.components[component] = { enabled, level: level || LogLevel.INFO };
  } else {
    config.components[component]!.enabled = enabled;
    if (level) {
      config.components[component]!.level = level;
    }
  }
  store.set('loggerConfig', config);
}

export function getLoggerConfig(): LoggerConfig {
  return config;
}

export function resetLoggerConfig() {
  config = defaultConfig;
  store.set('loggerConfig', config);
  configureLogger();
}

// Override console methods to use our logger (optional)
export function overrideConsole() {
  const originalConsole = {
    log: console.log,
    error: console.error,
    warn: console.warn,
    info: console.info,
    debug: console.debug
  };
  
  console.log = (...args: any[]) => logger.main.info(args.join(' '));
  console.error = (...args: any[]) => logger.main.error(args.join(' '));
  console.warn = (...args: any[]) => logger.main.warn(args.join(' '));
  console.info = (...args: any[]) => logger.main.info(args.join(' '));
  console.debug = (...args: any[]) => logger.main.debug(args.join(' '));
  
  return originalConsole;
}