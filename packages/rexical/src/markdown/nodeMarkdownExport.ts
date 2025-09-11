/**
 * Custom markdown export for individual nodes.
 * This fixes the issue where the standard Lexical $convertToMarkdownString
 * doesn't properly handle exporting individual non-root nodes.
 *
 * Based on the fix from our fork of lexical-markdown.
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

/**
 * Convert a single node to markdown string.
 * Unlike the standard $convertToMarkdownString, this properly handles individual nodes.
 */
export function $convertNodeToMarkdownString(
  transformers: Array<Transformer>,
  node?: ElementNode | null,
  shouldPreserveNewLines: boolean = false,
): string {
  const exportMarkdown = createMarkdownExport(
    transformers,
    shouldPreserveNewLines,
  );
  const result = exportMarkdown(node);
  if (node && node.getType && node.getType() === 'table') {
    console.log('  $convertNodeToMarkdownString final result for table:', result);
  }
  return result;
}

/**
 * Create a markdown export function with the provided transformers.
 * This is the fixed version that properly handles individual nodes.
 */
function createMarkdownExport(
  transformers: Array<Transformer>,
  shouldPreserveNewLines: boolean = false,
): (node?: ElementNode | null) => string {
  const byType = transformersByType(transformers);
  const isNewlineDelimited = !byType.multilineElement.length;
  
  // Like Lexical, only use single-format transformers and put code formats at the end
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
    if (node && node.getType && node.getType() === 'table') {
      console.log('  createMarkdownExport called with table node');
      console.log('  Is root or shadow?', $isRootOrShadowRoot(node));
    }

    // Export a specific node if provided, otherwise export the entire document
    // HACK: TableNode incorrectly reports as root/shadow, so explicitly check for it
    if (node && (!$isRootOrShadowRoot(node) || node.getType() === 'table')) {
      // CRITICAL FIX: Export the single node directly
      const result = exportTopLevelElements(
        node,
        elementTransformers,
        textFormatTransformers,
        textMatchTransformers,
        shouldPreserveNewLines,
      );

      if (result != null) {
        if (node.getType() === 'table') {
          console.log('  createMarkdownExport: GOT RESULT:', result.substring(0, 100));
          console.log('  createMarkdownExport: pushing result to output');
        }
        output.push(result);
        if (node.getType() === 'table') {
          console.log('  createMarkdownExport: output array now has', output.length, 'items');
          console.log('  createMarkdownExport: output[0]:', output[0].substring(0, 100));
        }
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

        if (result != null) {
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

    // Ensure consecutive groups of texts are at least \n\n apart
    const finalResult = output.join('\n\n');
    if (node && node.getType && node.getType() === 'table') {
      console.log('  createMarkdownExport: final result:', finalResult.substring(0, 100));
    }
    return finalResult;
  };
}

function exportTopLevelElements(
  node: LexicalNode,
  elementTransformers: Array<ElementTransformer | MultilineElementTransformer>,
  textFormatTransformers: Array<TextFormatTransformer>,
  textMatchTransformers: Array<TextMatchTransformer>,
  shouldPreserveNewLines: boolean = false,
): string | null {
  // Debug: log what node type we're exporting
  // console.log('exportTopLevelElements called with node type:', node.getType());
  // console.log('Number of element transformers:', elementTransformers.length);

  for (const transformer of elementTransformers) {
    if (!transformer.export) {
      continue;
    }
    if (node.getType() === 'table') {
      console.log('  Trying transformer for table:', transformer.type, transformer.dependencies?.map?.(d => typeof d === 'function' ? d.name : d));
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
      if (node.getType() === 'table') {
        console.log('  ✅ Table transformer matched and returned:', result.substring(0, 100));
        console.log('  Full table result:', result);
      }
      return result;
    }
  }

  if ($isElementNode(node)) {
    // console.log('  No transformer matched, falling back to exportChildren for:', node.getType());
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
  // In case text content is plain text then we can skip text matching
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
              (_node, textContent) =>
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
          (_node) =>
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
        // We need to get the element transformers from the parent scope
        // The module-level elementTransformers is empty, we need the actual ones
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
