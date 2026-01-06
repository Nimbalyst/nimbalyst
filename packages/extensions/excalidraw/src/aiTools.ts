/**
 * AI Tools for Excalidraw
 *
 * Provides Claude with tools to view and edit Excalidraw diagrams.
 */

import type { ExcalidrawElement } from '@excalidraw/excalidraw/types/types';
import { convertToExcalidrawElements } from '@excalidraw/excalidraw';
import { parseMermaidToExcalidraw } from '@excalidraw/mermaid-to-excalidraw';
import { getEditorAPI } from './editorRegistry';
import { LayoutEngine } from './layout/LayoutEngine';
import { createLabeledRectangle, createArrow } from './utils/elementFactory';

// Expose for testing
if (typeof window !== 'undefined') {
  (window as any).__excalidraw_parseMermaidToExcalidraw = parseMermaidToExcalidraw;
  (window as any).__excalidraw_convertToExcalidrawElements = convertToExcalidrawElements;
}

/**
 * Helper to get an element by its label text
 */
function getElementByLabel(elements: readonly ExcalidrawElement[], label: string): ExcalidrawElement | undefined {
  return elements.find((el) => {
    if ('text' in el && el.text === label) return true;
    if ('label' in el && (el as any).label?.text === label) return true;
    return false;
  });
}

/**
 * AI tool definitions (exported as array)
 */
export const aiTools = [
  {
    name: 'view_diagram',
    description: 'Capture screenshot of current Excalidraw diagram',
    parameters: {
      type: 'object' as const,
      properties: {},
    },
    handler: async (_params: Record<string, never>, context: { activeFilePath?: string }) => {
      // Screenshot will be handled by the screenshot service
      return {
        success: true,
        message: 'Screenshot capture requested.',
        captureScreenshot: true,
        data: {
          filePath: context.activeFilePath,
        },
      };
    },
  },

  {
    name: 'get_elements',
    description: 'Get list of diagram elements with labels and group membership',
    parameters: {
      type: 'object' as const,
      properties: {},
    },
    handler: async (_params: Record<string, never>, context: { activeFilePath?: string }) => {
      const api = getEditorAPI(context.activeFilePath);
      if (!api) {
        return {
          success: false,
          error: 'No active Excalidraw editor found. Please open a .excalidraw file first.',
        };
      }

      const sceneElements = api.getSceneElements();

      // Extract labeled elements
      const elements = sceneElements
        .filter((el) => {
          if ('text' in el && el.text) return true;
          if ('label' in el && (el as any).label?.text) return true;
          return false;
        })
        .map((el) => {
          const label = ('text' in el && el.text) || ('label' in el && (el as any).label?.text) || '';

          return {
            id: el.id,
            type: el.type,
            label,
          };
        });

      return {
        success: true,
        data: { elements },
      };
    },
  },

  {
    name: 'add_rectangle',
    description: 'Add a labeled rectangle to the diagram',
    parameters: {
      type: 'object' as const,
      properties: {
        label: {
          type: 'string' as const,
          description: 'Text label for the rectangle',
        },
        nearElement: {
          type: 'string' as const,
          description: 'Optional element label to place near',
        },
        style: {
          type: 'string' as const,
          enum: ['default', 'highlight', 'muted'],
          description: 'Visual style for the element',
        },
      },
      required: ['label'],
    },
    handler: async (
      params: {
        label: string;
        nearElement?: string;
        style?: string;
      },
      context: { activeFilePath?: string }
    ) => {
      const api = getEditorAPI(context.activeFilePath);
      if (!api) {
        return {
          success: false,
          error: 'No active Excalidraw editor found.',
        };
      }

      const { label, nearElement, style = 'default' } = params;
      const currentElements = api.getSceneElements() || [];

      const engine = new LayoutEngine();
      engine.addElements(currentElements);

      let position: { x: number; y: number };
      const width = 150;
      const height = 80;

      if (nearElement) {
        const nearEl = getElementByLabel(currentElements, nearElement);
        if (nearEl) {
          position = engine.calculateNearPosition(nearEl.id, width, height);
        } else {
          position = engine.calculateDefaultPosition(width, height);
        }
      } else {
        position = engine.calculateDefaultPosition(width, height);
      }

      const { rectangle, text } = createLabeledRectangle({
        x: position.x,
        y: position.y,
        width,
        height,
        text: label,
        style: style as any,
        groupIds: [],
      });

      // Update scene with new elements
      api.updateScene({
        elements: [...currentElements, rectangle, text],
      });

      return { success: true, data: { id: rectangle.id } };
    },
  },

  {
    name: 'add_arrow',
    description: 'Add an arrow connecting two elements',
    parameters: {
      type: 'object' as const,
      properties: {
        from: {
          type: 'string' as const,
          description: 'Label of the source element',
        },
        to: {
          type: 'string' as const,
          description: 'Label of the target element',
        },
        label: {
          type: 'string' as const,
          description: 'Optional label for the arrow',
        },
      },
      required: ['from', 'to'],
    },
    handler: async (
      params: {
        from: string;
        to: string;
        label?: string;
      },
      context: { activeFilePath?: string }
    ) => {
      const api = getEditorAPI(context.activeFilePath);
      if (!api) {
        return {
          success: false,
          error: 'No active Excalidraw editor found.',
        };
      }

      const currentElements = api.getSceneElements();
      const fromEl = getElementByLabel(currentElements, params.from);
      const toEl = getElementByLabel(currentElements, params.to);

      if (!fromEl || !toEl) {
        return {
          success: false,
          error: `Could not find elements: ${!fromEl ? params.from : ''} ${!toEl ? params.to : ''}`,
        };
      }

      // Calculate arrow start and end points from element bounds
      const fromCenterX = fromEl.x + (fromEl.width || 0) / 2;
      const fromCenterY = fromEl.y + (fromEl.height || 0) / 2;
      const toCenterX = toEl.x + (toEl.width || 0) / 2;
      const toCenterY = toEl.y + (toEl.height || 0) / 2;

      const arrowElements = createArrow({
        startX: fromCenterX,
        startY: fromCenterY,
        endX: toCenterX,
        endY: toCenterY,
        startElementId: fromEl.id,
        endElementId: toEl.id,
        label: params.label,
      });

      api.updateScene({
        elements: [...currentElements, ...arrowElements],
      });

      return { success: true, data: { id: arrowElements[0].id } };
    },
  },

  {
    name: 'update_element',
    description: 'Update text or style of existing element',
    parameters: {
      type: 'object' as const,
      properties: {
        label: {
          type: 'string' as const,
          description: 'Current label of the element to update',
        },
        newLabel: {
          type: 'string' as const,
          description: 'New label text',
        },
        style: {
          type: 'string' as const,
          description: 'New style',
        },
      },
      required: ['label'],
    },
    handler: async (
      params: {
        label: string;
        newLabel?: string;
        style?: string;
      },
      context: { activeFilePath?: string }
    ) => {
      const api = getEditorAPI(context.activeFilePath);
      if (!api) {
        return {
          success: false,
          error: 'No active Excalidraw editor found.',
        };
      }

      const currentElements = api.getSceneElements();
      const element = getElementByLabel(currentElements, params.label);

      if (!element) {
        return {
          success: false,
          error: `Element not found: ${params.label}`,
        };
      }

      const updates: Partial<ExcalidrawElement> = {};
      if (params.newLabel && 'text' in element) {
        updates.text = params.newLabel;
      }

      const updatedElements = currentElements.map((el) =>
        el.id === element.id ? { ...el, ...updates } : el
      );

      api.updateScene({ elements: updatedElements });

      return { success: true };
    },
  },

  {
    name: 'remove_element',
    description: 'Remove an element by label',
    parameters: {
      type: 'object' as const,
      properties: {
        label: {
          type: 'string' as const,
          description: 'Label of the element to remove',
        },
      },
      required: ['label'],
    },
    handler: async (
      params: { label: string },
      context: { activeFilePath?: string }
    ) => {
      const api = getEditorAPI(context.activeFilePath);
      if (!api) {
        return {
          success: false,
          error: 'No active Excalidraw editor found.',
        };
      }

      const currentElements = api.getSceneElements();
      const element = getElementByLabel(currentElements, params.label);

      if (!element) {
        return {
          success: false,
          error: `Element not found: ${params.label}`,
        };
      }

      const updatedElements = currentElements.filter((el) => el.id !== element.id);

      api.updateScene({ elements: updatedElements });

      return { success: true };
    },
  },

  {
    name: 'relayout',
    description: 'Re-run layout engine on entire diagram',
    parameters: {
      type: 'object' as const,
      properties: {
        algorithm: {
          type: 'string' as const,
          enum: ['hierarchical', 'force-directed', 'grid'],
          description: 'Layout algorithm to use',
        },
        direction: {
          type: 'string' as const,
          enum: ['TB', 'LR', 'BT', 'RL'],
          description: 'Direction for hierarchical layout',
        },
      },
    },
    handler: async (
      params: {
        algorithm?: string;
        direction?: string;
      },
      context: { activeFilePath?: string }
    ) => {
      const api = getEditorAPI(context.activeFilePath);
      if (!api) {
        return {
          success: false,
          error: 'No active Excalidraw editor found.',
        };
      }

      const algorithm = (params.algorithm || 'hierarchical') as 'hierarchical' | 'force-directed' | 'grid';
      const direction = (params.direction || 'TB') as 'TB' | 'LR' | 'BT' | 'RL';

      const currentElements = api.getSceneElements();
      const engine = new LayoutEngine();
      engine.addElements(currentElements);

      const positions = engine.layout({
        algorithm,
        direction,
      });

      const updatedElements = currentElements.map((el) => {
        const pos = positions.get(el.id);
        return pos ? { ...el, x: pos.x, y: pos.y } : el;
      });

      api.updateScene({ elements: updatedElements });

      return { success: true };
    },
  },

  {
    name: 'import_mermaid',
    description: 'Import a Mermaid diagram into Excalidraw. Use this to create complex architecture diagrams, flowcharts, and system designs.',
    parameters: {
      type: 'object' as const,
      properties: {
        mermaid: {
          type: 'string' as const,
          description: 'Mermaid diagram syntax (e.g., "graph TD; A-->B; B-->C")',
        },
      },
      required: ['mermaid'],
    },
    handler: async (
      params: { mermaid: string },
      context: { activeFilePath?: string }
    ) => {
      const api = getEditorAPI(context.activeFilePath);
      if (!api) {
        return {
          success: false,
          error: 'No active Excalidraw editor found.',
        };
      }

      try {
        const { elements, files } = await parseMermaidToExcalidraw(params.mermaid, {
          fontSize: 16,
        });

        // Convert skeleton elements to proper Excalidraw elements
        const excalidrawElements = convertToExcalidrawElements(elements);

        console.log('[import_mermaid] Got', elements.length, 'skeleton elements');
        console.log('[import_mermaid] Converted to', excalidrawElements.length, 'excalidraw elements');

        const currentElements = api.getSceneElements();
        console.log('[import_mermaid] Current scene has', currentElements.length, 'elements');

        // Add converted elements to the scene
        const newElements = [...currentElements, ...excalidrawElements];
        console.log('[import_mermaid] Updating scene with', newElements.length, 'total elements');

        api.updateScene({
          elements: newElements,
        });

        console.log('[import_mermaid] After updateScene, scene has', api.getSceneElements().length, 'elements');

        return {
          success: true,
          message: `Imported Mermaid diagram: ${elements.length} skeleton → ${excalidrawElements.length} elements`
        };
      } catch (error) {
        return {
          success: false,
          error: `Failed to parse Mermaid: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  },
];
