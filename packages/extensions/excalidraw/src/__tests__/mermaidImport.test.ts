/**
 * Test Mermaid import to understand what parseMermaidToExcalidraw returns
 */

import { describe, it, expect } from 'vitest';

describe('Mermaid Import', () => {
  it('should parse a simple mermaid diagram and log the structure', async () => {
    const { parseMermaidToExcalidraw } = await import('@excalidraw/mermaid-to-excalidraw');

    const mermaidDiagram = `graph TD
      A[Start] --> B[Process]
      B --> C[End]`;

    const result = await parseMermaidToExcalidraw(mermaidDiagram, {
      themeVariables: { fontSize: '16px' },
    });

    console.log('Mermaid parse result:', JSON.stringify(result, null, 2));

    expect(result).toBeDefined();
    expect(result.elements).toBeDefined();
    expect(Array.isArray(result.elements)).toBe(true);

    // Log each element's structure
    result.elements.forEach((el: any, index: number) => {
      console.log(`\nElement ${index} (${el.type}):`, {
        id: el.id,
        type: el.type,
        boundElements: el.boundElements,
        groupIds: el.groupIds,
        points: el.points,
        hasAllRequiredFields: {
          boundElements: 'boundElements' in el,
          boundElementsIsArray: Array.isArray(el.boundElements),
          boundElementsValue: el.boundElements,
          groupIds: 'groupIds' in el,
          groupIdsIsArray: Array.isArray(el.groupIds),
          points: el.type === 'arrow' ? Array.isArray(el.points) : 'N/A',
        }
      });
    });
  });

  it('should parse a subgraph diagram', async () => {
    const { parseMermaidToExcalidraw } = await import('@excalidraw/mermaid-to-excalidraw');

    const mermaidDiagram = `graph TD
      subgraph Presentation["Presentation Tier"]
        UI[Web Browser]
        Mobile[Mobile App]
      end

      subgraph Application["Application Tier"]
        API[API Server]
        Auth[Auth Service]
      end

      UI --> API
      Mobile --> API`;

    const result = await parseMermaidToExcalidraw(mermaidDiagram, {
      themeVariables: { fontSize: '16px' },
    });

    console.log('\n\nSubgraph parse result element count:', result.elements.length);

    // Check for any undefined array properties
    const problemElements = result.elements.filter((el: any) => {
      return el.boundElements === undefined ||
             el.groupIds === undefined ||
             (el.type === 'arrow' && el.points === undefined);
    });

    console.log('Problem elements:', problemElements);

    expect(problemElements.length).toBe(0);
  });
});
