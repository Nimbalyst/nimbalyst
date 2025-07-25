import { MultilineElementTransformer } from "@lexical/markdown";
import type { LexicalNode } from "lexical";
import { $createCodeNode } from "@lexical/code";
import { $createExcalidrawNode, $isExcalidrawNode, ExcalidrawNode } from "./index.tsx";

export const ExcalidrawTransform: MultilineElementTransformer = {
    dependencies: [ExcalidrawNode],
    export: (node: LexicalNode) => {
        if (!$isExcalidrawNode(node)) {
            return null;
        }

        const data = JSON.parse(node.__data);
        data.width = node.getWidth() === 'inherit' ? undefined : node.getWidth();
        data.height = node.getHeight() === 'inherit' ? undefined : node.getHeight();

        try {
            return `\`\`\`excalidraw\n${JSON.stringify(data)}\n\`\`\``;

        } catch (e) {
            console.error("Failed to export Excalidraw node:", e);
        }


    },
    regExpStart: /^```(excalidraw)$/,
    regExpEnd: {
        optional: true,
        regExp: /^```$/,
    },
    replace: (
        rootNode,
        children,
        startMatch,
        endMatch,
        linesInBetween,
        isImport,
    ) => {
        if (!linesInBetween) {
            return;
        }

        const excalidrawData = JSON.parse(linesInBetween.join('\n').trim());

        try {


            // Create ExcalidrawNode with the basic data and canvas dimensions
            const excalidrawNode = $createExcalidrawNode(
                JSON.stringify(excalidrawData),
                excalidrawData?.width,
                excalidrawData?.height
            );

            rootNode.append(excalidrawNode);
        } catch (error) {
            console.error("Failed to convert DiagramLM to Excalidraw:", error);

            // Fall back to a code block with the YAML content

            const codeBlock = $createCodeNode(excalidrawData);
            rootNode.append(codeBlock);


        }
    },
    type: 'multiline-element',
};
