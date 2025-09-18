/**
 * Enhanced markdown export with frontmatter support.
 * This module extends Lexical's markdown export capabilities to support:
 * - Individual node export (not just root nodes)
 * - Frontmatter metadata export from root node state
 * - Proper handling of all node types
 *
 * Replaces the previous custom implementation in nodeMarkdownExport.ts
 */

import {
  $getRoot,
  $isDecoratorNode,
  $isElementNode,
  $isLineBreakNode,
  $isRootOrShadowRoot,
  $isTextNode,
  ElementNode,
  LexicalNode,
  TextNode
} from 'lexical';

import type {
  ElementTransformer,
  MultilineElementTransformer,
  TextFormatTransformer,
  TextMatchTransformer,
  Transformer,
} from '@lexical/markdown';

import {
  $getFrontmatter,
  serializeWithFrontmatter,
  type FrontmatterData
} from './FrontmatterUtils';

/**
 * Options for enhanced markdown export.
 */
export interface EnhancedExportOptions {
  shouldPreserveNewLines?: boolean;
  includeFrontmatter?: boolean;
}

/**
 * Convert the entire editor to markdown string with optional frontmatter.
 * This is the primary export for full document conversion.
 */
export function $convertToEnhancedMarkdownString(
  transformers: Array<Transformer>,
  options: EnhancedExportOptions = {}
): string {
  const {
    shouldPreserveNewLines = true,
    includeFrontmatter = true
  } = options;

  // Get the markdown content
  const markdownContent = $convertNodeToEnhancedMarkdownString(
    transformers,
    null,
    shouldPreserveNewLines
  );

  // Add frontmatter if requested and available
  if (includeFrontmatter) {
    const frontmatter = $getFrontmatter();
    return serializeWithFrontmatter(markdownContent, frontmatter);
  }

  return markdownContent;
}

/**
 * Convert a single node to markdown string.
 * Unlike the standard $convertToMarkdownString, this properly handles individual nodes.
 */
export function $convertNodeToEnhancedMarkdownString(
  transformers: Array<Transformer>,
  node?: ElementNode | null,
  shouldPreserveNewLines: boolean = true,
): string {
  const exportMarkdown = createEnhancedMarkdownExport(
    transformers,
    shouldPreserveNewLines,
  );
  return exportMarkdown(node);
}

/**
 * Create an enhanced markdown export function with the provided transformers.
 * This properly handles individual nodes and maintains compatibility with standard Lexical export.
 */
function createEnhancedMarkdownExport(
  transformers: Array<Transformer>,
  shouldPreserveNewLines: boolean = true,
): (node?: ElementNode | null) => string {
  const byType = transformersByType(transformers);
  const isNewlineDelimited = !byType.multilineElement.length;

  // Only use single-format transformers and put code formats at the end
  const textFormatTransformers = byType.textFormat
    .filter((transformer) => transformer.format.length === 1)
    .sort((a, b) => {
      return (
        Number(a.format.includes('code')) - Number(b.format.includes('code'))
      );
    });

  const textMatchTransformers = byType.textMatch;
  const elementTransformers = [...byType.element, ...byType.multilineElement];

  return (node) => {
    const output: string[] = [];

    // Export a specific node if provided, otherwise export the entire document
    // HACK: TableNode incorrectly reports as root/shadow, so explicitly check for it
    if (node && (!$isRootOrShadowRoot(node) || node.getType() === 'table')) {
      // Export the single node directly
      const result = exportTopLevelElements(
        node,
        elementTransformers,
        textFormatTransformers,
        textMatchTransformers,
        shouldPreserveNewLines,
      );

      if (result !== null) {
        output.push(result);
      }
    } else {
      // Standard behavior for root nodes
      const children = (node || $getRoot()).getChildren();

      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        const result = exportTopLevelElements(
          child,
          elementTransformers,
          textFormatTransformers,
          textMatchTransformers,
          shouldPreserveNewLines,
        );

        if (result !== null) {
          output.push(
            // separate consecutive group of texts with a line break
            isNewlineDelimited &&
              i > 0 &&
              !isEmptyParagraph(child) &&
              !isEmptyParagraph(children[i - 1])
              ? '\n'.concat(result)
              : result,
          );
        }
      }
    }

    // Join with appropriate separator based on newline preservation
    // When preserving newlines, empty paragraphs are already represented correctly
    return output.join(shouldPreserveNewLines ? '\n' : '\n\n');
  };
}

function exportTopLevelElements(
  node: LexicalNode,
  elementTransformers: Array<ElementTransformer | MultilineElementTransformer>,
  textFormatTransformers: Array<TextFormatTransformer>,
  textMatchTransformers: Array<TextMatchTransformer>,
  shouldPreserveNewLines: boolean = false,
): string | null {
  for (const transformer of elementTransformers) {
    if (!transformer.export) {
      continue;
    }

    const result = transformer.export(node, (_node) =>
      exportChildren(
        _node,
        textFormatTransformers,
        textMatchTransformers,
        undefined,
        undefined,
        shouldPreserveNewLines,
        elementTransformers,
      ),
    );

    if (result != null) {
      return result;
    }
  }

  if ($isElementNode(node)) {
    return exportChildren(
      node,
      textFormatTransformers,
      textMatchTransformers,
      undefined,
      undefined,
      shouldPreserveNewLines,
      elementTransformers,
    );
  } else if ($isDecoratorNode(node)) {
    return node.getTextContent();
  } else {
    return null;
  }
}

function exportChildren(
  node: ElementNode,
  textFormatTransformers: Array<TextFormatTransformer>,
  textMatchTransformers: Array<TextMatchTransformer>,
  textContent?: string,
  textTransformer?: TextFormatTransformer | null,
  shouldPreserveNewLines: boolean = false,
  elementTransformers?: Array<ElementTransformer | MultilineElementTransformer>,
): string {
  const output = [];
  const children = node.getChildren();

  mainLoop: for (const child of children) {
    if ($isLineBreakNode(child)) {
      if (shouldPreserveNewLines) {
        output.push('\n');
      }
    } else if ($isTextNode(child)) {
      const textContentForTransform =
        textContent || child.getTextContent();

      if (textTransformer) {
        // TextFormatTransformer doesn't have an export method
        // This appears to be a bug in the original code
        // For now, just push the text content
        output.push(textContentForTransform);
      } else {
        // First check for text format transformers
        const hasFormatting = child.getFormat() !== 0;
        let handled = false;

        if (hasFormatting) {
          // Use a simplified version of Lexical's exportTextFormat
          const formattedText = exportTextFormat(
            child,
            textContentForTransform,
            textFormatTransformers,
          );
          output.push(formattedText);
          handled = true;
        } else {
          // Text matching transformers for text nodes
          for (const transformer of textMatchTransformers) {
            if (!transformer.export) {
              continue;
            }
            const result = transformer.export(
              child,
              textContentForTransform,
              (_node: ElementNode, textContent?: string) =>
                exportChildren(
                  _node,
                  textFormatTransformers,
                  textMatchTransformers,
                  textContent,
                  textTransformer,
                  shouldPreserveNewLines,
                  elementTransformers,
                ),
            );

            if (result != null) {
              output.push(result);
              handled = true;
              continue mainLoop;
            }
          }
        }

        if (!handled) {
          output.push(textContentForTransform);
        }
      }
    } else if ($isElementNode(child)) {
      // First check if any text-match transformer handles this element node (like LINK for LinkNode)
      let handled = false;
      for (const transformer of textMatchTransformers) {
        if (!transformer.export) {
          continue;
        }
        const result = transformer.export(
          child,
          (_node: ElementNode) =>
            exportChildren(
              _node,
              textFormatTransformers,
              textMatchTransformers,
              undefined,
              undefined,
              shouldPreserveNewLines,
              elementTransformers,
            ),
        );

        if (result != null) {
          output.push(result);
          handled = true;
          break;
        }
      }

      if (!handled) {
        const result = exportTopLevelElements(
          child,
          elementTransformers || [],
          textFormatTransformers,
          textMatchTransformers,
          shouldPreserveNewLines,
        );

        if (result != null) {
          output.push(result);
        }
      }
    } else if ($isDecoratorNode(child)) {
      output.push(child.getTextContent());
    }
  }

  return output.join('');
}

function exportTextFormat(
  node: TextNode,
  textContent: string,
  textTransformers: Array<TextFormatTransformer>,
): string {
  // Simplified version of Lexical's exportTextFormat
  // We don't track unclosed tags across siblings since we're exporting individual nodes

  let output = textContent;

  // If node has no format, return original text
  if (node.getFormat() === 0) {
    return output;
  }

  // Don't escape markdown characters if this is code
  if (!node.hasFormat('code')) {
    output = output.replace(/([*_`~\\])/g, '\\$1');
  }

  // Collect applicable transformers
  const applied: string[] = [];

  for (const transformer of textTransformers) {
    // Only use single-format transformers for export
    if (transformer.format.length !== 1) {
      continue;
    }

    const format = transformer.format[0];
    if (node.hasFormat(format)) {
      applied.push(transformer.tag);
    }
  }

  // Apply tags in order (opening at start, closing at end in reverse)
  const openingTags = applied.join('');
  const closingTags = applied.slice().reverse().join('');

  return openingTags + output + closingTags;
}

function isEmptyParagraph(node: LexicalNode): boolean {
  if (!$isElementNode(node)) {
    return false;
  }

  const children = node.getChildren();
  if (children.length === 0) {
    return true;
  }

  if (children.length === 1) {
    const child = children[0];
    if ($isTextNode(child) && child.getTextContent().trim() === '') {
      return true;
    }
  }

  return false;
}

function transformersByType(transformers: Array<Transformer>) {
  const byType: {
    element: Array<ElementTransformer>;
    multilineElement: Array<MultilineElementTransformer>;
    textFormat: Array<TextFormatTransformer>;
    textMatch: Array<TextMatchTransformer>;
  } = {
    element: [],
    multilineElement: [],
    textFormat: [],
    textMatch: [],
  };

  for (const transformer of transformers) {
    const type = transformer.type;
    if (type === 'element') {
      byType.element.push(transformer as ElementTransformer);
    } else if (type === 'multiline-element') {
      byType.multilineElement.push(transformer as MultilineElementTransformer);
    } else if (type === 'text-format') {
      byType.textFormat.push(transformer as TextFormatTransformer);
    } else if (type === 'text-match') {
      byType.textMatch.push(transformer as TextMatchTransformer);
    }
  }

  return byType;
}