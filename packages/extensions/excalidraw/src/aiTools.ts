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
    description: 'Add a labeled rectangle to the diagram. Rectangles are rounded by default.',
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
        color: {
          type: 'string' as const,
          description: 'Fill color. PREFER Excalidraw default palette for best visual consistency: #ffc9c9 (red), #b2f2bb (green), #a5d8ff (blue), #ffec99 (yellow), #ffd8a8 (orange), #e599f7 (purple), #ffc0cb (pink). When user says "red", use #ffc9c9 not #ff0000.',
        },
        strokeColor: {
          type: 'string' as const,
          description: 'Border color (hex code or color name)',
        },
        rounded: {
          type: 'boolean' as const,
          description: 'Whether to use rounded corners (default: true)',
        },
      },
      required: ['label'],
    },
    handler: async (
      params: {
        label: string;
        nearElement?: string;
        color?: string;
        strokeColor?: string;
        rounded?: boolean;
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

      const { label, nearElement, color, strokeColor, rounded = true } = params;
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
        backgroundColor: color,
        strokeColor,
        roundness: rounded ? { type: 3 } : null,
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
    description: 'Update text, color, or style of existing element. Can look up by ID or label.',
    parameters: {
      type: 'object' as const,
      properties: {
        id: {
          type: 'string' as const,
          description: 'Element ID to update (use this if you have the ID from get_elements)',
        },
        label: {
          type: 'string' as const,
          description: 'Current label of the element to update (alternative to id)',
        },
        newLabel: {
          type: 'string' as const,
          description: 'New label text',
        },
        color: {
          type: 'string' as const,
          description: 'New fill color (hex code or color name)',
        },
        strokeColor: {
          type: 'string' as const,
          description: 'New border color (hex code or color name)',
        },
      },
    },
    handler: async (
      params: {
        id?: string;
        label?: string;
        newLabel?: string;
        color?: string;
        strokeColor?: string;
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

      if (!params.id && !params.label) {
        return {
          success: false,
          error: 'Must provide either id or label',
        };
      }

      const currentElements = api.getSceneElements();

      // Find element by ID or label
      let textElement: ExcalidrawElement | undefined;
      if (params.id) {
        textElement = currentElements.find(el => el.id === params.id);
      } else if (params.label) {
        textElement = getElementByLabel(currentElements, params.label);
      }

      if (!textElement) {
        return {
          success: false,
          error: `Element not found: ${params.label}`,
        };
      }

      // Helper to normalize colors to Excalidraw palette
      const normalizeColor = (color?: string): string | undefined => {
        if (!color) return undefined;
        const colorMap: Record<string, string> = {
          red: '#ffc9c9', green: '#b2f2bb', blue: '#a5d8ff', yellow: '#ffec99',
          orange: '#ffd8a8', purple: '#e599f7', pink: '#ffc0cb', gray: '#e9ecef', grey: '#e9ecef',
        };
        return colorMap[color.toLowerCase()] || color;
      };

      // Find the container (rectangle) if this is a text element bound to one
      let containerElement: ExcalidrawElement | undefined;
      if ('containerId' in textElement && textElement.containerId) {
        containerElement = currentElements.find(el => el.id === textElement.containerId);
      }

      // Prepare updates for text element
      const textUpdates: any = {};
      if (params.newLabel && 'text' in textElement) {
        textUpdates.text = params.newLabel;
      }

      // Prepare updates for container (for color changes)
      const containerUpdates: any = {};
      if (params.color !== undefined) {
        containerUpdates.backgroundColor = normalizeColor(params.color);
      }
      if (params.strokeColor !== undefined) {
        containerUpdates.strokeColor = normalizeColor(params.strokeColor);
      }

      // Apply updates
      const updatedElements = currentElements.map((el) => {
        if (el.id === textElement.id && Object.keys(textUpdates).length > 0) {
          return { ...el, ...textUpdates };
        }
        if (containerElement && el.id === containerElement.id && Object.keys(containerUpdates).length > 0) {
          return { ...el, ...containerUpdates };
        }
        return el;
      });

      api.updateScene({ elements: updatedElements });

      return { success: true };
    },
  },

  {
    name: 'remove_element',
    description: 'Remove an element by ID or label',
    parameters: {
      type: 'object' as const,
      properties: {
        id: {
          type: 'string' as const,
          description: 'Element ID to remove (use this if you have the ID from get_elements)',
        },
        label: {
          type: 'string' as const,
          description: 'Label of the element to remove (alternative to id)',
        },
      },
    },
    handler: async (
      params: { id?: string; label?: string },
      context: { activeFilePath?: string }
    ) => {
      const api = getEditorAPI(context.activeFilePath);
      if (!api) {
        return {
          success: false,
          error: 'No active Excalidraw editor found.',
        };
      }

      if (!params.id && !params.label) {
        return {
          success: false,
          error: 'Must provide either id or label',
        };
      }

      const currentElements = api.getSceneElements();

      // Find element by ID or label
      let element: ExcalidrawElement | undefined;
      if (params.id) {
        element = currentElements.find(el => el.id === params.id);
      } else if (params.label) {
        element = getElementByLabel(currentElements, params.label);
      }

      if (!element) {
        return {
          success: false,
          error: `Element not found`,
        };
      }

      // Remove both the element and its container (if it's a text element)
      let idsToRemove = [element.id];
      if ('containerId' in element && element.containerId) {
        idsToRemove.push(element.containerId as string);
      }

      const updatedElements = currentElements.filter((el) => !idsToRemove.includes(el.id));

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

  {
    name: 'clear_all',
    description: 'Remove all elements from the diagram',
    parameters: {
      type: 'object' as const,
      properties: {},
    },
    handler: async (
      params: Record<string, never>,
      context: { activeFilePath?: string }
    ) => {
      const api = getEditorAPI(context.activeFilePath);
      if (!api) {
        return {
          success: false,
          error: 'No active Excalidraw editor found.',
        };
      }

      api.updateScene({ elements: [] });

      return {
        success: true,
        message: 'Cleared all elements from the diagram'
      };
    },
  },
];
