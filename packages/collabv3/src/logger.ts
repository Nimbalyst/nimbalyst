/**
 * Simple logger for CollabV3 that respects environment settings.
 *
 * In production: Only errors and warnings are logged
 * In development: All logs including debug are shown
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

let currentEnvironment: string = 'production';

/**
 * Set the current environment for logging.
 * Call this once at worker initialization.
 */
export function setLogEnvironment(env: string): void {
  currentEnvironment = env;
}

/**
 * Check if we're in development mode.
 */
function isDev(): boolean {
  return currentEnvironment === 'development' || currentEnvironment === 'local';
}

/**
 * Log a debug message (only in development).
 */
export function debug(tag: string, ...args: unknown[]): void {
  if (isDev()) {
    console.log(`[${tag}]`, ...args);
  }
}

/**
 * Log an info message (only in development).
 */
export function info(tag: string, ...args: unknown[]): void {
  if (isDev()) {
    console.log(`[${tag}]`, ...args);
  }
}

/**
 * Log a warning message (always logged).
 */
export function warn(tag: string, ...args: unknown[]): void {
  console.warn(`[${tag}]`, ...args);
}

/**
 * Log an error message (always logged).
 */
export function error(tag: string, ...args: unknown[]): void {
  console.error(`[${tag}]`, ...args);
}

/**
 * Create a scoped logger with a fixed tag.
 */
export function createLogger(tag: string) {
  return {
    debug: (...args: unknown[]) => debug(tag, ...args),
    info: (...args: unknown[]) => info(tag, ...args),
    warn: (...args: unknown[]) => warn(tag, ...args),
    error: (...args: unknown[]) => error(tag, ...args),
  };
}
