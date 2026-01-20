/**
 * Type definitions for Image Generation Extension
 */

// Supported image generation styles
export type ImageStyle =
  | 'sketch'
  | 'diagram'
  | 'illustration'
  | 'photorealistic'
  | 'wireframe'
  | 'custom';

// Supported aspect ratios
export type AspectRatio = '1:1' | '16:9' | '9:16' | '4:3' | '3:4';

/**
 * A single generated image result
 */
export interface GeneratedImage {
  /** Filename within the .imgproj.images folder */
  file: string;
  /** Random seed used for generation */
  seed: number;
  /** Width in pixels */
  width: number;
  /** Height in pixels */
  height: number;
}

/**
 * A single generation request and its results
 */
export interface Generation {
  /** Unique identifier for this generation */
  id: string;
  /** The prompt used for generation */
  prompt: string;
  /** Style preset used */
  style: ImageStyle;
  /** Aspect ratio used */
  aspectRatio: AspectRatio;
  /** Provider-specific parameters */
  parameters: Record<string, unknown>;
  /** When the generation was created */
  timestamp: string;
  /** Array of generated image results */
  results: GeneratedImage[];
  /** Error message if generation failed */
  error?: string;
}

/**
 * Project settings
 */
export interface ProjectSettings {
  /** Default style for new generations */
  defaultStyle: ImageStyle;
  /** Number of variations to generate per prompt */
  variationsPerPrompt: number;
  /** Default aspect ratio */
  defaultAspectRatio?: AspectRatio;
}

/**
 * The .imgproj file format
 */
export interface ImageProject {
  /** File format version */
  version: number;
  /** Project name */
  name: string;
  /** Creation timestamp */
  created: string;
  /** Provider ID (e.g., "nano-banana") */
  provider: string;
  /** Array of generations in reverse chronological order (newest first) */
  generations: Generation[];
  /** Project settings */
  settings: ProjectSettings;
}

/**
 * Request to generate an image
 */
export interface GenerationRequest {
  /** The prompt describing the image */
  prompt: string;
  /** Style preset */
  style?: ImageStyle;
  /** Aspect ratio */
  aspectRatio?: AspectRatio;
  /** Number of variations to generate */
  numVariations?: number;
  /** Specific seed for reproducibility */
  seed?: number;
  /** Provider-specific options */
  providerOptions?: Record<string, unknown>;
}

/**
 * Result from image generation
 */
export interface GenerationResult {
  /** Array of generated images */
  images: GeneratedImage[];
  /** Metadata about the generation */
  metadata: {
    /** Provider ID */
    provider: string;
    /** Model name/version */
    model: string;
    /** Generation timestamp */
    timestamp: string;
  };
}

/**
 * Capabilities exposed by an image provider
 */
export interface ProviderCapabilities {
  /** Available style options */
  styles: ImageStyle[];
  /** Whether the provider supports generating variations */
  supportsVariations: boolean;
  /** Whether the provider supports inpainting */
  supportsInpainting: boolean;
  /** Maximum images per request */
  maxImagesPerRequest: number;
  /** Supported aspect ratios */
  supportedAspectRatios: AspectRatio[];
}

/**
 * Interface that all image providers must implement
 */
export interface ImageProvider {
  /** Unique provider identifier */
  id: string;
  /** Human-readable provider name */
  name: string;
  /** Provider capabilities */
  capabilities: ProviderCapabilities;
  /**
   * Generate images from a prompt
   */
  generateImage(request: GenerationRequest): Promise<GenerationResult>;
  /**
   * Check if the provider is configured and ready to use
   */
  isConfigured(): boolean;
}

/**
 * Style preset configuration
 */
export interface StylePreset {
  id: ImageStyle;
  label: string;
  description: string;
  /** Icon or emoji for the style */
  icon?: string;
}

/**
 * Available style presets
 */
export const STYLE_PRESETS: StylePreset[] = [
  {
    id: 'sketch',
    label: 'Sketch',
    description: 'Hand-drawn look, architecture diagrams',
    icon: '&#128393;',
  },
  {
    id: 'diagram',
    label: 'Diagram',
    description: 'Flowcharts, system diagrams',
    icon: '&#128200;',
  },
  {
    id: 'illustration',
    label: 'Illustration',
    description: 'Blog graphics, icons',
    icon: '&#127912;',
  },
  {
    id: 'photorealistic',
    label: 'Photorealistic',
    description: 'Product shots, scenes',
    icon: '&#128247;',
  },
  {
    id: 'wireframe',
    label: 'Wireframe',
    description: 'UI mockups',
    icon: '&#128187;',
  },
];

/**
 * Aspect ratio configuration
 */
export interface AspectRatioOption {
  id: AspectRatio;
  label: string;
  width: number;
  height: number;
}

/**
 * Available aspect ratios
 */
export const ASPECT_RATIOS: AspectRatioOption[] = [
  { id: '1:1', label: '1:1 Square', width: 1024, height: 1024 },
  { id: '16:9', label: '16:9 Wide', width: 1920, height: 1080 },
  { id: '9:16', label: '9:16 Portrait', width: 1080, height: 1920 },
  { id: '4:3', label: '4:3 Standard', width: 1024, height: 768 },
  { id: '3:4', label: '3:4 Portrait', width: 768, height: 1024 },
];
