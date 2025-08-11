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
  TextFormatType,
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
  return exportMarkdown(node);
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
  const textFormatTransformers = byType.textFormat;
  const textMatchTransformers = byType.textMatch;
  const elementTransformers = [...byType.element, ...byType.multilineElement];

  return (node) => {
    const output: string[] = [];

    // Export a specific node if provided, otherwise export the entire document
    if (node && !$isRootOrShadowRoot(node)) {
      // CRITICAL FIX: Export the single node directly
      const result = exportTopLevelElements(
        node,
        elementTransformers,
        textFormatTransformers,
        textMatchTransformers,
        shouldPreserveNewLines,
      );

      if (result != null) {
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
    return output.join('\n\n');
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
        output.push(
          textTransformer.export(
            child,
            textContentForTransform,
            (_node, textContent) =>
              exportChildren(
                _node,
                textFormatTransformers,
                textMatchTransformers,
                textContent,
                null,
                shouldPreserveNewLines,
              ),
          ),
        );
      } else {
        const tag = getTextFormatTransformerTag(
          child,
          textContentForTransform,
          textFormatTransformers,
        );

        if (tag) {
          output.push(tag.export(
            child,
            textContentForTransform,
            (node, textContent) =>
              exportChildren(
                node,
                textFormatTransformers,
                textMatchTransformers,
                textContent,
                tag,
                shouldPreserveNewLines,
              ),
          ));
        } else {
          // Text matching
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
                ),
            );

            if (result != null) {
              output.push(result);
              continue mainLoop;
            }
          }

          output.push(textContentForTransform);
        }
      }
    } else if ($isElementNode(child)) {
      const result = exportTopLevelElements(
        child,
        [...elementTransformers],
        textFormatTransformers,
        textMatchTransformers,
        shouldPreserveNewLines,
      );

      if (result != null) {
        output.push(result);
      }
    } else if ($isDecoratorNode(child)) {
      output.push(child.getTextContent());
    }
  }

  return output.join('');
}

function getTextFormatTransformerTag(
  node: TextNode,
  textContent: string,
  textFormatTransformers: Array<TextFormatTransformer>,
): TextFormatTransformer | null {
  // This needs to be in reverse order to match the nesting of formats
  for (let i = textFormatTransformers.length - 1; i >= 0; i--) {
    const transformer = textFormatTransformers[i];
    if (transformer.format.includes(node.getFormat() as TextFormatType)) {
      return transformer;
    }
  }

  return null;
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

// Need to define elementTransformers at module level for exportTopLevelElements
let elementTransformers: Array<ElementTransformer | MultilineElementTransformer> = [];