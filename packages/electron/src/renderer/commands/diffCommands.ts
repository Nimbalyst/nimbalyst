/**
 * Electron-specific diff commands
 * These commands handle history tag management for AI diff operations
 */

import { createCommand, LexicalCommand } from 'lexical';

/**
 * Command to clear diff mode after incremental accept/reject operations
 * This marks the AI edit tag as reviewed without indicating accept/reject
 */
export const CLEAR_DIFF_TAG_COMMAND: LexicalCommand<void> = createCommand(
  'CLEAR_DIFF_TAG_COMMAND'
);
