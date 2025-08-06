import type { TextMatchTransformer } from '@lexical/markdown';
import { $createMathNode, $isMathNode, MathNode } from './MathNode';

export const MATH_TRANSFORMER: TextMatchTransformer = {
  dependencies: [MathNode],
  export: (node) => {
    if (!$isMathNode(node)) {
      return null;
    }
    return node.__inline 
      ? `$${node.__equation}$` 
      : `$$\n${node.__equation}\n$$`;
  },
  importRegExp: /\$\$([^$]+)\$\$|\$([^$]+)\$/,
  regExp: /\$\$([^$]+)\$\$|\$([^$]+)\$$/,
  replace: (textNode, match) => {
    const [full, blockEquation, inlineEquation] = match;
    const equation = blockEquation || inlineEquation;
    const inline = !blockEquation;
    const mathNode = $createMathNode(equation, inline);
    textNode.replace(mathNode);
  },
  trigger: '$',
  type: 'text-match',
};
