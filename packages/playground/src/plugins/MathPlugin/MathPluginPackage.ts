import type { PluginPackage } from '@stravu/stravu-editor';
import MathPlugin from './MathPlugin';
import { MathNode } from './MathNode';
import { MATH_TRANSFORMER } from './MathTransformer';
import { INSERT_MATH_COMMAND } from './MathPlugin';

export const MathPluginPackage: PluginPackage = {
  name: 'math',
  Component: MathPlugin,
  nodes: [MathNode],
  transformers: [MATH_TRANSFORMER],
  commands: {
    INSERT_MATH: INSERT_MATH_COMMAND,
  },
};
