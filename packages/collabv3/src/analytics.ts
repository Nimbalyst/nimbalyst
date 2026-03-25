/**
 * Cloudflare Analytics Engine helper.
 *
 * Fire-and-forget data point writes for product usage metrics.
 * No-ops when the ANALYTICS binding is missing (dev/test).
 */

import type { Env } from './types';

/**
 * Write a single analytics data point.
 * Never throws -- analytics must not break request handling.
 */
export function track(
  env: Env,
  index: string,
  blobs: string[] = [],
  doubles: number[] = []
): void {
  try {
    env.ANALYTICS?.writeDataPoint({ indexes: [index], blobs, doubles });
  } catch {
    // Swallow -- analytics failures must never affect the request
  }
}
