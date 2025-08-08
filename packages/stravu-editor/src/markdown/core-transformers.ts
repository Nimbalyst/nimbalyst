/**
 * Core markdown transformers that are always included.
 * These handle basic markdown syntax that doesn't require plugins.
 */

import {
  CHECK_LIST,
  ELEMENT_TRANSFORMERS,
  MULTILINE_ELEMENT_TRANSFORMERS,
  TEXT_FORMAT_TRANSFORMERS,
  TEXT_MATCH_TRANSFORMERS,
  Transformer,
} from '@lexical/markdown';

import { HR_TRANSFORMER } from './HorizontalRuleTransformer';

/**
 * Core transformers that are always available in the editor.
 * These don't require any plugins to be loaded.
 */
export const CORE_TRANSFORMERS: Array<Transformer> = [
  // Core element transformers
  HR_TRANSFORMER, // Horizontal rules are core markdown
  
  // All built-in Lexical markdown transformers are core
  CHECK_LIST,
  ...ELEMENT_TRANSFORMERS,
  ...MULTILINE_ELEMENT_TRANSFORMERS,
  ...TEXT_FORMAT_TRANSFORMERS,
  ...TEXT_MATCH_TRANSFORMERS,
];