/**
 * Hook that returns a formatted elapsed time string while a tool is running.
 * Updates every second when enabled. Returns null when disabled.
 */

import { useState, useEffect } from 'react';

/**
 * Format milliseconds into a human-readable elapsed time string.
 * - Under 60s: "5s"
 * - Under 60m: "2m 15s"
 * - 60m+: "1h 5m"
 */
function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m ${seconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

/**
 * Returns a formatted elapsed time string that updates every second.
 *
 * @param enabled - Whether to tick (typically `isRunning`)
 * @param startTimestamp - Epoch ms when the tool started (e.g., `message.timestamp`)
 * @returns Formatted elapsed string like "5s", "2m 15s", or null when disabled
 */
export function useElapsedTime(enabled: boolean, startTimestamp: number | undefined): string | null {
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    if (!enabled) return;
    // Tick immediately to get accurate initial value
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [enabled]);

  if (!enabled || !startTimestamp) return null;
  const elapsed = now - startTimestamp;
  if (elapsed < 0) return null;
  return formatElapsed(elapsed);
}
