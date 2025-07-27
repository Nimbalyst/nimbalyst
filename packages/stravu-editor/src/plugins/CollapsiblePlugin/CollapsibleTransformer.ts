/**
 * Transformer for collapsible nodes using code fence syntax with attributes
 * Supports: ```collapsible{classification="thinking" open="false" readOnly="true"}
 */

import {$createTextNode, $isElementNode, $isTextNode, LexicalNode, $isParagraphNode} from 'lexical';
import {$convertFromMarkdownString, MultilineElementTransformer} from '@lexical/markdown';
import {
    $createStyledCollapsible,
} from './index';
import {
    ATTRIBUTE_PATTERNS,
    parseAttributesWithMappings,
    serializeAttributesWithMappings
} from '../../utils/NodeSerializationUtils';
import {PLAYGROUND_TRANSFORMERS} from '../MarkdownTransformers';
import { $isCollapsibleContainerNode } from "./CollapsibleContainerNode";
import { $isCollapsibleTitleNode } from "./CollapsibleTitleNode";
import { $isCollapsibleContentNode } from "./CollapsibleContentNode";

// Parse the content to extract title and body
function parseCollapsibleContent(content: string): { title: string; body: string } {
    const lines = content.trim().split('\n');

    // Look for the first heading as title
    const titleLineIndex = lines.findIndex(line => line.trim().startsWith('#'));

    if (titleLineIndex !== -1) {
        const titleLine = lines[titleLineIndex];
        const title = titleLine.replace(/^#+\s*/, '').trim();

        // Everything after the title line is body content
        const bodyLines = lines.slice(titleLineIndex + 1);
        const body = bodyLines.join('\n').trim();

        return { title, body };
    }

    // If no heading found, treat first line as title, rest as body
    const title = lines[0]?.trim() || 'Collapsible Section';
    const body = lines.slice(1).join('\n').trim();

    return { title, body };
}

// Extract text content from a node tree (for title only)
function extractTextContent(node: LexicalNode): string {
    if ($isTextNode(node)) {
        return node.getTextContent();
    }

    if ($isElementNode(node)) {
        const children = node.getChildren();
        return children.map(child => extractTextContent(child)).join('');
    }

    return '';
}

// Helper function to recursively serialize a node and its children (like Lexical's private exportNodeToJSON)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serializeNodeWithChildren(node: LexicalNode): any {
    const serializedNode = node.exportJSON();

    if ($isElementNode(node)) {
        const serializedChildren = (serializedNode as any).children;
        if (Array.isArray(serializedChildren)) {
            // Clear the children array and repopulate with serialized children
            serializedChildren.length = 0;
            const children = node.getChildren();
            for (const child of children) {
                serializedChildren.push(serializeNodeWithChildren(child));
            }
        }
    }

    return serializedNode;
}

export const COLLAPSIBLE_TRANSFORMER: MultilineElementTransformer = {
    dependencies: [],
    export: (node: LexicalNode) => {
        if (!$isCollapsibleContainerNode(node)) {
            return null;
        }

        const children = node.getChildren();
        const titleNode = children.find($isCollapsibleTitleNode);
        const contentNode = children.find($isCollapsibleContentNode);

        if (!titleNode || !contentNode) {
            return null;
        }

        // Extract title as plain text
        const title = extractTextContent(titleNode);

        // Use headless editor to export content as markdown with error handling
        const contentChildren = contentNode.getChildren();
        let bodyMarkdown = '';

        try {
            bodyMarkdown = contentChildren.map(child => {
                try {
                    if ($isParagraphNode(child)) {
                        // TODO: A Lexical bug prevents us from using $convertToMarkdownString for paragraphs here, we're losing all formatting inside the collapsible content

                        return child.getTextContent();

                        // const md = $convertToMarkdownString(PLAYGROUND_TRANSFORMERS, child as ElementNode, true);
                        // return md || '';
                    }
                } catch (error) {
                    console.warn('Failed to convert child to markdown:', error);
                    return '';
                }
            }).join('\n');
        } catch (error) {
            console.warn('Failed to process content children:', error);
            return null;
        }

        // Get node properties and build attributes object
        const nodeAttributes = {
            classification: node?.getClassification(),
            isOpen: node.getOpen(),
            readOnly: node?.getReadOnly(),
        };

        // Filter out undefined values and serialize with key mappings
        const cleanAttributes = Object.fromEntries(
            Object.entries(nodeAttributes).filter(([_, value]) => value !== undefined)
        );

        const attributeString = serializeAttributesWithMappings(
            cleanAttributes,
            ATTRIBUTE_PATTERNS.collapsible.keyMappings
        );

        // Escape triple backticks in markdown to prevent breaking the code fence
        const escapedBodyMarkdown = bodyMarkdown ? bodyMarkdown.replace(/```/g, '\\`\\`\\`') : '';

        // Build the markdown representation
        const content = escapedBodyMarkdown ? `# ${title}\n\n${escapedBodyMarkdown}` : `# ${title}`;

        return `\`\`\`collapsible${attributeString}\n${content}\n\`\`\``;
    },
    regExpStart: /^```collapsible(?:\{([^}]*)\})?\s*$/,
    regExpEnd: /^```\s*$/,
    replace: (rootNode, children, startMatch, endMatch, linesInBetween) => {

        // Extract attribute string from the start match
        const attributeString = startMatch[1] || '';

        // Join the lines in between as content
        const markdownContent = linesInBetween?.join('\n') || '';

        // Parse attributes with key mappings
        const attributes = parseAttributesWithMappings(
            attributeString,
            ATTRIBUTE_PATTERNS.collapsible.keyMappings
        );

        // Parse content for title and body
        const { title, body } = parseCollapsibleContent(markdownContent);

        // Create the collapsible with parsed attributes
        const { container, titleParagraph, content } = $createStyledCollapsible({
            classification: attributes.classification,
            isOpen: attributes.isOpen !== undefined ? attributes.isOpen : true,
            readOnly: attributes.readOnly || false,
        });

        // Set the title
        titleParagraph.append($createTextNode(title));

        // Parse the body content as markdown and add to content paragraph with error handling
        if (body) {
            // Unescape any escaped triple backticks before parsing markdown
            const unescapedBody = body.replace(/\\`\\`\\`/g, '```');

            try {
                $convertFromMarkdownString(unescapedBody, PLAYGROUND_TRANSFORMERS, content, true, false);
            } catch (error) {
                console.warn('Failed to convert markdown to nodes:', error);
                // Fallback: add as plain text
                content.append($createTextNode(unescapedBody));
            }
        }

        // Replace the root node with our container
        rootNode.append(container);

        // Set safe selection after transformation
        try {
            container.selectEnd();
        } catch (error) {
            console.warn('Failed to set selection after collapsible creation:', error);
        }
    },
    type: 'multiline-element',
};
