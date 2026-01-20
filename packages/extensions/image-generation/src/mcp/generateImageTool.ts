/**
 * Generate Image AI Tool
 *
 * MCP tool that allows the coding agent to generate images.
 */

import { getEditorAPI } from '../editorRegistry';
import type { ImageStyle, AspectRatio } from '../types';

/**
 * AI tool definition for generate_image
 */
export const generateImageTool = {
  name: 'generate_image',
  description: `Generate an image using AI. Can create sketches, diagrams, photorealistic images, and more.

Use this tool when the user asks you to create or generate:
- Architecture diagrams
- System flow diagrams
- UI wireframes
- Sketches or illustrations
- Any visual content

The image will be added to the active image generation project (.imgproj file).
If no project is open, you should first create one.`,
  scope: 'global' as const, // Available even when no .imgproj file is open
  parameters: {
    type: 'object' as const,
    properties: {
      prompt: {
        type: 'string' as const,
        description:
          'Detailed description of the image to generate. Be specific about layout, elements, style, and any text that should appear.',
      },
      style: {
        type: 'string' as const,
        enum: ['sketch', 'diagram', 'illustration', 'photorealistic', 'wireframe'],
        description: `Visual style for the generated image:
- sketch: Hand-drawn look, good for architecture diagrams
- diagram: Clean technical flowcharts and system diagrams
- illustration: Colorful graphics and icons
- photorealistic: Realistic product shots and scenes
- wireframe: UI mockups and layouts`,
      },
      aspectRatio: {
        type: 'string' as const,
        enum: ['1:1', '16:9', '9:16', '4:3', '3:4'],
        description: 'Aspect ratio for the image (default: 1:1)',
      },
      variations: {
        type: 'number' as const,
        description: 'Number of variations to generate (1-4, default: 3)',
      },
      projectFile: {
        type: 'string' as const,
        description:
          'Optional: path to .imgproj file to add this generation to. If not provided, uses the active editor.',
      },
    },
    required: ['prompt'],
  },
  handler: async (
    params: {
      prompt: string;
      style?: ImageStyle;
      aspectRatio?: AspectRatio;
      variations?: number;
      projectFile?: string;
    },
    context: { activeFilePath?: string }
  ) => {
    const {
      prompt,
      style = 'sketch',
      aspectRatio = '1:1',
      variations = 3,
      projectFile,
    } = params;

    // Get the editor API
    const api = getEditorAPI(projectFile || context.activeFilePath);

    if (!api) {
      return {
        success: false,
        error:
          'No active image generation project found. Please open or create an .imgproj file first.',
      };
    }

    try {
      // Trigger generation through the editor
      await api.generate(prompt, style, aspectRatio, Math.min(4, Math.max(1, variations)));

      return {
        success: true,
        message: `Image generation started with prompt: "${prompt.substring(0, 50)}${prompt.length > 50 ? '...' : ''}"`,
        data: {
          prompt,
          style,
          aspectRatio,
          variations,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to generate image: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
};
