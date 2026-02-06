/**
 * Startup Timing Instrumentation
 *
 * Provides lightweight timing instrumentation for measuring main process
 * initialization performance. Always enabled to help diagnose slow startup
 * on all platforms. The overhead is negligible (Date.now() calls + Map entries).
 */

const isEnabled = true;

const startupStart = Date.now();
const timings: Map<string, { start: number; end?: number }> = new Map();

/**
 * Mark the start of a timed section.
 * @param name Identifier for this section (e.g., 'database-init')
 */
export function markStart(name: string): void {
  if (!isEnabled) return;
  timings.set(name, { start: Date.now() });
}

/**
 * Mark the end of a timed section and log the duration.
 * @param name Identifier for this section (must match markStart name)
 */
export function markEnd(name: string): void {
  if (!isEnabled) return;

  const timing = timings.get(name);
  if (!timing) {
    console.warn(`[STARTUP] No start mark found for: ${name}`);
    return;
  }

  timing.end = Date.now();
  const duration = timing.end - timing.start;
  const elapsed = timing.end - startupStart;

  console.log(`[STARTUP] ${name}: ${duration}ms (total: ${elapsed}ms)`);
}

/**
 * Log a timing checkpoint (instant mark, no duration).
 * @param name Identifier for this checkpoint
 */
export function checkpoint(name: string): void {
  if (!isEnabled) return;

  const elapsed = Date.now() - startupStart;
  console.log(`[STARTUP] ${name}: +${elapsed}ms`);
}

/**
 * Get a summary of all recorded timings.
 */
export function getSummary(): Record<string, { duration: number; total: number }> {
  const summary: Record<string, { duration: number; total: number }> = {};

  for (const [name, timing] of timings) {
    if (timing.end) {
      summary[name] = {
        duration: timing.end - timing.start,
        total: timing.end - startupStart
      };
    }
  }

  return summary;
}

/**
 * Get total elapsed time since startup began.
 */
export function getTotalStartupTime(): number {
  return Date.now() - startupStart;
}

/**
 * Log the final startup summary.
 */
export function logSummary(): void {
  if (!isEnabled) return;

  const totalTime = getTotalStartupTime();
  console.log('\n[STARTUP] === Summary ===');
  console.log(`[STARTUP] Total startup time: ${totalTime}ms`);

  const summary = getSummary();
  const entries = Object.entries(summary).sort((a, b) => b[1].duration - a[1].duration);

  console.log('[STARTUP] Top operations by duration:');
  for (const [name, { duration }] of entries.slice(0, 10)) {
    const pct = ((duration / totalTime) * 100).toFixed(1);
    console.log(`[STARTUP]   ${name}: ${duration}ms (${pct}%)`);
  }
  console.log('[STARTUP] ==================\n');
}
