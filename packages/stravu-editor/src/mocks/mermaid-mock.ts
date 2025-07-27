// Mock for @excalidraw/mermaid-to-excalidraw to avoid bundling huge mermaid dependencies

export const parseMermaidToExcalidraw = async () => {
  throw new Error('Mermaid diagram import is not supported in this build');
};

export default {
  parseMermaidToExcalidraw
};
