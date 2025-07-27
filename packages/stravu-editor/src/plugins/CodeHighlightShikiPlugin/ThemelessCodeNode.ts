import { CodeNode, SerializedCodeNode } from "@lexical/code";
import { DOMConversionMap, EditorConfig } from "lexical";


export class ThemelessCodeNode extends CodeNode  {


    static getType(): string {
        return CodeNode.getType();
    }

    static clone(node: ThemelessCodeNode): ThemelessCodeNode {
        return new ThemelessCodeNode(node.__language, node.__key);
    }

    constructor(language?: string | null | undefined, key?: string) {
        super(language, key);
    }

    createDOM(editor: EditorConfig): HTMLElement {
        const dom = super.createDOM(editor);
        dom.classList.add('themeless-code');
        return dom;
    }


    getTheme(): string | undefined {
        return undefined; // No theme for themeless code nodes
    }

    static importDOM(): DOMConversionMap | null {
        return CodeNode.importDOM();
    }

    static importJSON(serializedNode: SerializedCodeNode): CodeNode {
        return $createThemelessCodeNode().updateFromJSON(serializedNode);
    }

}

export function $createThemelessCodeNode(language?: string | null): ThemelessCodeNode {
    return new ThemelessCodeNode(language);
}
