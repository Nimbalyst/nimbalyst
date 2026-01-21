/**
 * ImageCompressor - Handles image compression for chat attachments
 * Uses Jimp for pure JavaScript image processing (no native bindings)
 *
 * Strategy: Prioritize text readability by keeping PNG format (lossless).
 * Only resize if dimensions exceed the maximum. This preserves crisp text
 * in screenshots while still reducing file sizes for very large images.
 */

import { Jimp } from 'jimp';

// heic-decode doesn't have type declarations
// eslint-disable-next-line @typescript-eslint/no-require-imports
const decodeHeic = require('heic-decode') as (options: {
  buffer: Buffer | ArrayBuffer;
}) => Promise<{ width: number; height: number; data: Uint8ClampedArray }>;

/**
 * Custom error types for granular error handling
 */
export class ImageCompressionError extends Error {
  constructor(message: string, public readonly cause?: Error) {
    super(message);
    this.name = 'ImageCompressionError';
  }
}

export class UnsupportedFormatError extends ImageCompressionError {
  constructor(mimeType: string, cause?: Error) {
    super(`Unsupported image format: ${mimeType}`, cause);
    this.name = 'UnsupportedFormatError';
  }
}

export class CorruptedImageError extends ImageCompressionError {
  constructor(cause?: Error) {
    super('Image data is corrupted or invalid', cause);
    this.name = 'CorruptedImageError';
  }
}

export class HeicDecodeError extends ImageCompressionError {
  constructor(cause?: Error) {
    super('Failed to decode HEIC/HEIF image', cause);
    this.name = 'HeicDecodeError';
  }
}

export interface CompressionResult {
  buffer: Buffer;
  mimeType: string;
  originalSize: number;
  compressedSize: number;
  width: number;
  height: number;
  wasCompressed: boolean; // true if compression reduced size, false if original returned
}

export interface CompressionOptions {
  maxDimension?: number;  // Default: 2048
}

const DEFAULT_OPTIONS: Required<CompressionOptions> = {
  maxDimension: 2048
};

// Minimum file size to bother processing (100KB)
const MIN_SIZE_FOR_COMPRESSION = 100 * 1024;

// HEIC MIME types (Apple's native format)
const HEIC_MIME_TYPES = ['image/heic', 'image/heif'];

// Use a simplified type for Jimp images since the library's generic types are complex
type JimpImage = Awaited<ReturnType<typeof Jimp.read>>;

/**
 * Decode HEIC/HEIF image to raw RGBA data, then create a Jimp image
 */
async function decodeHeicToJimp(buffer: Buffer): Promise<JimpImage> {
  try {
    const { data, width, height } = await decodeHeic({ buffer });

    // Create a new Jimp image from raw RGBA data
    const image = new Jimp({ width, height, color: 0x00000000 });
    image.bitmap.data = Buffer.from(data);

    // Cast to JimpImage - both types have the same runtime behavior
    // The type mismatch is due to Jimp's complex generic system
    return image as unknown as JimpImage;
  } catch (error) {
    throw new HeicDecodeError(error instanceof Error ? error : undefined);
  }
}

/**
 * Compress an image buffer while maintaining aspect ratio and text readability
 * - Resizes to fit within maxDimension (if larger)
 * - Keeps original format (PNG stays PNG, JPEG stays JPEG) to preserve text clarity
 * - Converts HEIC to PNG (Apple's native format not widely supported)
 * - PNG is lossless so text remains crisp after resize
 * - Returns original buffer if compression would increase file size
 *
 * @throws {UnsupportedFormatError} If image format cannot be processed
 * @throws {CorruptedImageError} If image data is invalid
 * @throws {HeicDecodeError} If HEIC decoding fails
 */
export async function compressImage(
  buffer: Buffer,
  mimeType: string,
  options: CompressionOptions = {}
): Promise<CompressionResult> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const originalSize = buffer.length;

  // Load image - handle HEIC specially since Jimp doesn't support it
  let image: JimpImage;
  try {
    if (HEIC_MIME_TYPES.includes(mimeType)) {
      image = await decodeHeicToJimp(buffer);
    } else {
      image = await Jimp.read(buffer);
    }
  } catch (error) {
    // Re-throw our custom errors
    if (error instanceof ImageCompressionError) {
      throw error;
    }
    // Check for common Jimp error patterns
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes('not supported') || errorMessage.includes('Unknown')) {
      throw new UnsupportedFormatError(mimeType, error instanceof Error ? error : undefined);
    }
    throw new CorruptedImageError(error instanceof Error ? error : undefined);
  }

  const originalWidth = image.width;
  const originalHeight = image.height;

  // Determine if resize is needed
  const needsResize = originalWidth > opts.maxDimension || originalHeight > opts.maxDimension;

  if (needsResize) {
    // Resize to fit within maxDimension, maintaining aspect ratio
    if (originalWidth > originalHeight) {
      image.resize({ w: opts.maxDimension });
    } else {
      image.resize({ h: opts.maxDimension });
    }
  }

  // Keep original format to preserve text readability
  // PNG is lossless - text stays crisp
  // JPEG users chose lossy format, so we keep it as JPEG
  // HEIC/WebP: convert to PNG for best text quality and compatibility
  let outputMime: string;
  let outputBuffer: Buffer;

  try {
    if (mimeType === 'image/png') {
      outputMime = 'image/png';
      outputBuffer = await image.getBuffer('image/png');
    } else if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') {
      outputMime = 'image/jpeg';
      // Use high quality (92) to preserve text in JPEGs
      outputBuffer = await image.getBuffer('image/jpeg', { quality: 92 });
    } else if (mimeType === 'image/webp' || HEIC_MIME_TYPES.includes(mimeType)) {
      // WebP/HEIC: convert to PNG for best text quality and compatibility
      outputMime = 'image/png';
      outputBuffer = await image.getBuffer('image/png');
    } else {
      // Fallback: keep as PNG
      outputMime = 'image/png';
      outputBuffer = await image.getBuffer('image/png');
    }
  } catch (error) {
    throw new ImageCompressionError(
      'Failed to encode compressed image',
      error instanceof Error ? error : undefined
    );
  }

  // If compression increased file size and format didn't change, return original
  // Exception: HEIC must always be converted (not widely supported)
  const formatChanged = outputMime !== mimeType;
  const isHeicConversion = HEIC_MIME_TYPES.includes(mimeType);

  if (outputBuffer.length >= originalSize && !isHeicConversion && !formatChanged) {
    return {
      buffer,
      mimeType,
      originalSize,
      compressedSize: originalSize,
      width: originalWidth,
      height: originalHeight,
      wasCompressed: false
    };
  }

  return {
    buffer: outputBuffer,
    mimeType: outputMime,
    originalSize,
    compressedSize: outputBuffer.length,
    width: image.width,
    height: image.height,
    wasCompressed: true
  };
}

/**
 * Check if image should be compressed based on size/dimensions
 * Skip compression for:
 * - Already small images (< 100KB)
 * - GIF (animated - compression would break animation)
 */
export function shouldCompress(buffer: Buffer, mimeType: string): boolean {
  // Skip GIFs (may be animated)
  if (mimeType === 'image/gif') {
    return false;
  }

  // Skip already small images
  if (buffer.length < MIN_SIZE_FOR_COMPRESSION) {
    return false;
  }

  return true;
}
