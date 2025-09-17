import type {Spread} from "lexical";

import {
    type DOMConversionMap,
    type DOMConversionOutput,
    type DOMExportOutput,
    type EditorConfig,
    type LexicalNode,
    type NodeKey,
    type SerializedTextNode,
    $applyNodeReplacement,
    TextNode,
} from "lexical";

import {TextMatchTransformer} from "@lexical/markdown";

export type SerializedDocumentReferenceNode = Spread<
    {
        documentId: string;
        name: string;
        path: string;
        workspace?: string;
    },
    SerializedTextNode
>;

function convertDocumentReferenceElement(
    domNode: HTMLElement,
): DOMConversionOutput | null {
    const textContent = domNode.textContent;

    if (textContent !== null) {
        const documentId = domNode.getAttribute('data-document-id') || '';
        const name = domNode.getAttribute('data-name') || '';
        const path = domNode.getAttribute('data-path') || '';
        const workspace = domNode.getAttribute('data-workspace') || undefined;
        const node = $createDocumentReferenceNode(documentId, name, path, workspace);
        return {
            node,
        };
    }

    return null;
}

export class DocumentReferenceNode extends TextNode {
    __documentId: string;
    __name: string;
    __path: string;
    __workspace?: string;

    static getType(): string {
        return 'document-reference';
    }

    static clone(node: DocumentReferenceNode): DocumentReferenceNode {
        return new DocumentReferenceNode(node.__documentId, node.__name, node.__path, node.__workspace, node.__text, node.__key);
    }

    static importJSON(serializedNode: SerializedDocumentReferenceNode): DocumentReferenceNode {
        const node = $createDocumentReferenceNode(
            serializedNode.documentId,
            serializedNode.name,
            serializedNode.path,
            serializedNode.workspace
        );
        node.setTextContent(serializedNode.text);
        node.setFormat(serializedNode.format);
        node.setDetail(serializedNode.detail);
        node.setMode(serializedNode.mode);
        node.setStyle(serializedNode.style);
        return node;
    }

    constructor(documentId: string, name: string, path: string, workspace?: string, text?: string, key?: NodeKey) {
        super(text ?? name, key);
        this.__documentId = documentId;
        this.__name = name;
        this.__path = path;
        this.__workspace = workspace;
    }

    exportJSON(): SerializedDocumentReferenceNode {
        return {
            ...super.exportJSON(),
            documentId: this.__documentId,
            name: this.__name,
            path: this.__path,
            workspace: this.__workspace,
            type: 'document-reference',
            version: 1,
        };
    }

    createDOM(config: EditorConfig): HTMLElement {
        const dom = super.createDOM(config);
        dom.spellcheck = false;
        dom.className = 'document-reference';
        dom.setAttribute('data-document-id', this.__documentId);
        dom.setAttribute('data-name', this.__name);
        dom.setAttribute('data-path', this.__path);
        if (this.__workspace) {
            dom.setAttribute('data-workspace', this.__workspace);
        } else {
            dom.removeAttribute('data-workspace');
        }
        return dom;
    }

    exportDOM(): DOMExportOutput {
        const element = document.createElement('span');
        element.className = 'document-reference'; // used for styling saved dom in prompt menu
        element.setAttribute('data-lexical-document-reference', 'true');
        element.setAttribute('data-document-id', this.__documentId);
        element.setAttribute('data-name', this.__name);
        element.setAttribute('data-path', this.__path);
        if (this.__workspace) {
            element.setAttribute('data-workspace', this.__workspace);
        }
        element.textContent = this.__text;
        return {element};
    }

    static importDOM(): DOMConversionMap | null {
        return {
            span: (domNode: HTMLElement) => {
                if (!domNode.hasAttribute('data-lexical-document-reference')) {
                    return null;
                }
                return {
                    conversion: convertDocumentReferenceElement,
                    priority: 1,
                };
            },
        };
    }

    isTextEntity(): true {
        return true;
    }

    canInsertTextBefore(): boolean {
        return false;
    }

    canInsertTextAfter(): boolean {
        return false;
    }

    getDocumentId(): string {
        return this.__documentId;
    }

    getName(): string {
        return this.__name;
    }

    getPath(): string {
        return this.__path;
    }

    getWorkspace(): string | undefined {
        return this.__workspace;
    }
}

export function $createDocumentReferenceNode(documentId: string, name: string, path: string, workspace?: string): DocumentReferenceNode {
    const documentReferenceNode = new DocumentReferenceNode(documentId, name, path, workspace);
    documentReferenceNode.setMode('segmented').toggleDirectionless();
    return $applyNodeReplacement(documentReferenceNode);
}

export function $isDocumentReferenceNode(
    node: LexicalNode | null | undefined,
): node is DocumentReferenceNode {
    return node instanceof DocumentReferenceNode;
}

export const DocumentReferenceTransformer: TextMatchTransformer = {
    dependencies: [DocumentReferenceNode],
    export: (node) => {
        if (!$isDocumentReferenceNode(node)) {
            return null;
        }
        const { __documentId, __name, __path, __workspace } = node;
        // Export as a more AI-friendly format that preserves the reference
        // This format is easier for AI to understand and less likely to be stripped
        return `[[document:${__name}|${__documentId}]]`;
    },
    importRegExp: /\[\[document:([^|]+)\|([^\]]+)\]\]/,
    regExp: /(\[\[document:[^|]+\|[^\]]+\]\])$/,
    replace: (textNode, match) => {
        const [, name, documentId] = match;
        // For now, we'll use empty path and no workspace for imports
        // These could be enhanced later if needed
        const documentReferenceNode = $createDocumentReferenceNode(documentId, name, '', undefined);
        textNode.replace(documentReferenceNode);
    },
    trigger: ']',
    type: 'text-match',
};
