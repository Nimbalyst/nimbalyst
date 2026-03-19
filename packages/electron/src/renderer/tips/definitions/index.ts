/**
 * Tip definitions registry
 *
 * All tip definitions are exported here as a single array.
 * Add new tip imports and include them in the array below.
 */

import type { TipDefinition } from '../types';
import { mobileKeepAwakeTip } from './mobile-keep-awake';

export const tips: TipDefinition[] = [
  mobileKeepAwakeTip,
];
