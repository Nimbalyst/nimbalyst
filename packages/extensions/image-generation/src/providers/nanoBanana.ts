/**
 * Nano Banana (Google Imagen) Provider
 *
 * Implementation using Google's Gemini API for Imagen image generation.
 * Uses the Imagen 4 model via REST API.
 *
 * API Documentation: https://ai.google.dev/gemini-api/docs/imagen
 */

import type {
  ImageProvider,
  GenerationRequest,
  GenerationResult,
  GeneratedImage,
  ProviderCapabilities,
} from '../types';

/**
 * Google Imagen API endpoint - using Imagen 4 (Standard)
 * Available models: imagen-4.0-generate-001, imagen-4.0-ultra-generate-001, imagen-4.0-fast-generate-001
 */
const IMAGEN_MODEL = 'imagen-4.0-generate-001';
const IMAGEN_API_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${IMAGEN_MODEL}:predict`;

/**
 * Response structure from Imagen API
 */
interface ImagenApiResponse {
  predictions?: Array<{
    bytesBase64Encoded?: string;
    mimeType?: string;
    raiFilteredReason?: string;
  }>;
  error?: {
    code: number;
    message: string;
    status: string;
  };
}

/**
 * Style prompt modifiers to enhance generation quality
 */
const STYLE_PROMPTS: Record<string, string> = {
  sketch:
    'hand-drawn sketch style, pencil drawing, line art, architectural sketch, clean lines',
  diagram:
    'technical diagram, flowchart style, clean geometric shapes, professional infographic, vector style',
  illustration:
    'digital illustration, colorful, vector art style, modern graphic design',
  photorealistic:
    'photorealistic, high detail, realistic lighting, professional photography',
  wireframe:
    'UI wireframe, grayscale, simple shapes, low fidelity mockup, user interface sketch',
};

/**
 * Nano Banana provider implementation using Google Imagen API
 */
export class NanoBananaProvider implements ImageProvider {
  id = 'nano-banana';
  name = 'Google Imagen';

  capabilities: ProviderCapabilities = {
    styles: ['sketch', 'diagram', 'illustration', 'photorealistic', 'wireframe'],
    supportsVariations: true,
    supportsInpainting: false,
    maxImagesPerRequest: 4,
    supportedAspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4'],
  };

  private apiKey: string | null = null;

  /**
   * Set the API key for authentication
   */
  setApiKey(apiKey: string): void {
    this.apiKey = apiKey;
  }

  /**
   * Get the current API key
   */
  getApiKey(): string | null {
    return this.apiKey;
  }

  /**
   * Check if the provider is configured
   */
  isConfigured(): boolean {
    return !!this.apiKey && this.apiKey.length > 0;
  }

  /**
   * Build the enhanced prompt with style modifiers
   */
  private buildPrompt(prompt: string, style?: string): string {
    const styleModifier = style && STYLE_PROMPTS[style] ? STYLE_PROMPTS[style] : '';
    if (styleModifier) {
      return `${prompt}. Style: ${styleModifier}`;
    }
    return prompt;
  }

  /**
   * Generate images from a prompt using Google Imagen API
   */
  async generateImage(request: GenerationRequest): Promise<GenerationResult> {
    console.log('[Imagen] Generate request:', request);

    if (!this.isConfigured()) {
      throw new Error(
        'Google Imagen is not configured. Please add your Google AI API key in Settings > AI Providers.'
      );
    }

    const numImages = Math.min(4, Math.max(1, request.numVariations || 1));
    const aspectRatio = request.aspectRatio || '1:1';
    const enhancedPrompt = this.buildPrompt(request.prompt, request.style);

    console.log('[Imagen] Enhanced prompt:', enhancedPrompt);
    console.log('[Imagen] Requesting', numImages, 'images with aspect ratio', aspectRatio);

    // Build the request body
    const requestBody = {
      instances: [
        {
          prompt: enhancedPrompt,
        },
      ],
      parameters: {
        sampleCount: numImages,
        aspectRatio: aspectRatio,
      },
    };

    try {
      const response = await fetch(IMAGEN_API_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': this.apiKey!,
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[Imagen] API error:', response.status, errorText);

        if (response.status === 401 || response.status === 403) {
          throw new Error(
            'Invalid Google AI API key. Please check your API key in Settings > AI Providers.'
          );
        }
        if (response.status === 429) {
          throw new Error('Rate limit exceeded. Please wait a moment and try again.');
        }
        if (response.status === 400) {
          // Try to parse the error for more details
          try {
            const errorJson = JSON.parse(errorText);
            throw new Error(errorJson.error?.message || 'Invalid request to Imagen API');
          } catch {
            throw new Error('Invalid request to Imagen API');
          }
        }

        throw new Error(`Imagen API error: ${response.status} ${response.statusText}`);
      }

      const data: ImagenApiResponse = await response.json();
      console.log('[Imagen] API response received, predictions:', data.predictions?.length);

      if (data.error) {
        throw new Error(data.error.message || 'Unknown API error');
      }

      if (!data.predictions || data.predictions.length === 0) {
        throw new Error('No images were generated. The prompt may have been filtered.');
      }

      // Process the predictions into GeneratedImage objects
      const timestamp = new Date().toISOString();
      const images: GeneratedImage[] = [];

      for (let i = 0; i < data.predictions.length; i++) {
        const prediction = data.predictions[i];

        if (prediction.raiFilteredReason) {
          console.warn('[Imagen] Image filtered:', prediction.raiFilteredReason);
          continue;
        }

        if (!prediction.bytesBase64Encoded) {
          console.warn('[Imagen] Prediction missing image data');
          continue;
        }

        // Generate a unique filename
        const filename = `gen-${Date.now()}-${i}.png`;

        images.push({
          file: filename,
          seed: Math.floor(Math.random() * 1000000), // Imagen doesn't return seeds
          width: this.getWidthForAspectRatio(aspectRatio),
          height: this.getHeightForAspectRatio(aspectRatio),
          // Store base64 data temporarily for saving
          _base64Data: prediction.bytesBase64Encoded,
        } as GeneratedImage & { _base64Data: string });
      }

      if (images.length === 0) {
        throw new Error(
          'All generated images were filtered. Try adjusting your prompt to be more appropriate.'
        );
      }

      console.log('[Imagen] Successfully generated', images.length, 'images');

      return {
        images,
        metadata: {
          provider: this.id,
          model: IMAGEN_MODEL,
          timestamp,
        },
      };
    } catch (error) {
      console.error('[Imagen] Generation failed:', error);
      throw error;
    }
  }

  /**
   * Get width for aspect ratio
   */
  private getWidthForAspectRatio(aspectRatio: string): number {
    const widthMap: Record<string, number> = {
      '1:1': 1024,
      '16:9': 1408,
      '9:16': 768,
      '4:3': 1152,
      '3:4': 896,
    };
    return widthMap[aspectRatio] || 1024;
  }

  /**
   * Get height for aspect ratio
   */
  private getHeightForAspectRatio(aspectRatio: string): number {
    const heightMap: Record<string, number> = {
      '1:1': 1024,
      '16:9': 768,
      '9:16': 1408,
      '4:3': 896,
      '3:4': 1152,
    };
    return heightMap[aspectRatio] || 1024;
  }
}

/**
 * Singleton instance of the Nano Banana provider
 */
export const nanoBananaProvider = new NanoBananaProvider();
