/**
 * MockupTransformer - Markdown transformer for mockup nodes.
 *
 * Uses extended image syntax to maintain compatibility with other markdown editors.
 * Format: ![alt](screenshot.png){mockup:wireframe.wireframe.html}{width}x{height}
 *
 * The screenshot path is primary for compatibility, the {mockup:...} extension
 * stores the wireframe source path.
 */

import { TextMatchTransformer } from '@lexical/markdown';

import { $createMockupNode, $isMockupNode, MockupNode } from './MockupNode';

/**
 * Regex for importing mockup from markdown.
 * Matches: ![alt](screenshot.png){mockup:wireframe.wireframe.html}{widthxheight}
 *
 * Groups:
 * 1. alt text
 * 2. screenshot path (can be empty)
 * 3. wireframe path
 * 4. width (optional)
 * 5. height (optional)
 *
 * Note: screenshot path can be empty (e.g., `()`) for mockups still generating.
 * Size syntax is `{widthxheight}` matching the image format.
 */
const MOCKUP_IMPORT_REGEX =
  /!(?:\[([^[]*)\])(?:\(([^)]*)\))(?:\{mockup:([^}]+)\})(?:\{(\d+)x(\d+)\})?/;

/**
 * Regex for detecting mockup while typing (triggers on closing brace).
 */
const MOCKUP_TYPING_REGEX =
  /!(?:\[([^[]*)\])(?:\(([^)]*)\))(?:\{mockup:([^}]+)\})(?:\{(\d+)x(\d+)\})?$/;

export const MOCKUP_TRANSFORMER: TextMatchTransformer = {
  dependencies: [MockupNode],

  export: (node) => {
    if (!$isMockupNode(node)) {
      return null;
    }

    const altText = node.getAltText();
    const screenshotPath = node.getScreenshotPath();
    const wireframePath = node.getWireframePath();
    const width = node.__width;
    const height = node.__height;

    // Build the markdown string
    let markdown = `![${altText}](${screenshotPath}){mockup:${wireframePath}}`;

    // Add size if both width and height are set (format: {widthxheight})
    if (width !== 'inherit' && height !== 'inherit') {
      markdown += `{${Math.round(width)}x${Math.round(height)}}`;
    }

    return markdown;
  },

  importRegExp: MOCKUP_IMPORT_REGEX,
  regExp: MOCKUP_TYPING_REGEX,

  replace: (textNode, match) => {
    const [, altText, screenshotPath, wireframePath, width, height] = match;

    const mockupNode = $createMockupNode({
      wireframePath,
      screenshotPath,
      altText: altText || 'Mockup',
      width: width ? parseInt(width) : undefined,
      height: height ? parseInt(height) : undefined,
    });

    textNode.replace(mockupNode);
  },

  trigger: '}',
  type: 'text-match',
};
