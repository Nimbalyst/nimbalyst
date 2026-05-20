/**
 * Math extension entry.
 *
 * Owns LaTeX math rendering for Nimbalyst in both the transcript and the
 * Lexical editor.
 */

import './styles.css';

import { TranscriptMathHost } from './TranscriptMathHost';
import {
  BLOCK_MATH_TRANSFORMER,
  INLINE_MATH_TRANSFORMER,
  MathLexicalExtension,
} from './lexical';

export async function activate(): Promise<void> {
  // Registration happens inside TranscriptMathHost so it follows the host
  // component's mount/unmount lifecycle; there is no work to do here.
}

export async function deactivate(): Promise<void> {
  // Same -- the host component cleans up its own contributions on unmount.
}

export const transformers = {
  BLOCK_MATH_TRANSFORMER,
  INLINE_MATH_TRANSFORMER,
};

export const lexicalExtensions = {
  MathLexicalExtension,
};

export const hostComponents = {
  TranscriptMathHost,
};
