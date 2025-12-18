/**
 * Custom widget for the capture_mockup_screenshot MCP tool
 *
 * Displays a preview of the captured mockup screenshot with:
 * - Thumbnail image preview (click to enlarge)
 * - File path information
 * - Success/error status badge
 * - Full-size lightbox modal
 *
 * Handles both inline base64 images and persisted-output files
 * (when Claude Code saves large outputs to files).
 */

import React, { useState, useEffect } from 'react';
import type { CustomToolWidgetProps } from './index';
import './MockupScreenshotWidget.css';

/**
 * Extract just the mockup name from a file path
 * e.g., "/path/to/my_mockup.mockup.html" -> "my_mockup"
 */
function extractMockupName(filePath: string): string {
  if (!filePath) return 'mockup';

  // Get the filename from the path
  const parts = filePath.split('/');
  const filename = parts[parts.length - 1] || '';

  // Remove .mockup.html extension
  const name = filename.replace(/\.mockup\.html$/i, '');

  return name || 'mockup';
}

/**
 * Extract the base64 image data from the tool result
 *
 * The MCP format returns: { type: 'image', source: { type: 'base64', data: '...', media_type: 'image/png' } }
 */
function extractImageData(result: any): { imageBase64: string; mimeType: string } | null {
  if (!result) return null;

  // Handle array of content blocks (MCP format)
  if (Array.isArray(result)) {
    for (const block of result) {
      // New MCP format: { type: 'image', source: { type: 'base64', data: '...', media_type: '...' } }
      if (block.type === 'image' && block.source?.data) {
        return {
          imageBase64: block.source.data,
          mimeType: block.source.media_type || 'image/png'
        };
      }
      // Old format: { type: 'image', data: '...', mimeType: '...' }
      if (block.type === 'image' && block.data) {
        return {
          imageBase64: block.data,
          mimeType: block.mimeType || 'image/png'
        };
      }
    }
    return null;
  }

  // Handle content wrapper object
  if (result.content && Array.isArray(result.content)) {
    for (const block of result.content) {
      // New MCP format
      if (block.type === 'image' && block.source?.data) {
        return {
          imageBase64: block.source.data,
          mimeType: block.source.media_type || 'image/png'
        };
      }
      // Old format
      if (block.type === 'image' && block.data) {
        return {
          imageBase64: block.data,
          mimeType: block.mimeType || 'image/png'
        };
      }
    }
    return null;
  }

  // Handle direct image data
  if (result.imageBase64) {
    return {
      imageBase64: result.imageBase64,
      mimeType: result.mimeType || 'image/png'
    };
  }

  return null;
}

/**
 * Check if the tool result contains a persisted-output reference
 * Claude Code saves large outputs to files with this format:
 * <persisted-output>Output too large (2MB). Full output saved to: /path/to/file</persisted-output>
 */
function isPersistedOutput(result: any): boolean {
  if (typeof result === 'string') {
    return result.includes('<persisted-output>');
  }

  // Handle array of content blocks
  if (Array.isArray(result)) {
    for (const block of result) {
      if (block.type === 'text' && typeof block.text === 'string' && block.text.includes('<persisted-output>')) {
        return true;
      }
    }
  }

  // Handle content wrapper object
  if (result?.content && Array.isArray(result.content)) {
    for (const block of result.content) {
      if (block.type === 'text' && typeof block.text === 'string' && block.text.includes('<persisted-output>')) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Extract the file path from a persisted-output reference
 */
function extractPersistedFilePath(result: any): string | null {
  const extractFromText = (text: string): string | null => {
    const match = text.match(/<persisted-output>[^]*?Full output saved to:\s*([^\s<]+)/);
    return match ? match[1] : null;
  };

  if (typeof result === 'string') {
    return extractFromText(result);
  }

  // Handle array of content blocks
  if (Array.isArray(result)) {
    for (const block of result) {
      if (block.type === 'text' && typeof block.text === 'string') {
        const path = extractFromText(block.text);
        if (path) return path;
      }
    }
  }

  // Handle content wrapper object
  if (result?.content && Array.isArray(result.content)) {
    for (const block of result.content) {
      if (block.type === 'text' && typeof block.text === 'string') {
        const path = extractFromText(block.text);
        if (path) return path;
      }
    }
  }

  return null;
}

/**
 * Parse image data from a persisted output file's JSON content
 */
function parsePersistedImageData(fileContent: string): { imageBase64: string; mimeType: string } | null {
  try {
    const parsed = JSON.parse(fileContent);

    // The file contains an array of MCP content blocks
    const blocks = Array.isArray(parsed) ? parsed : parsed?.content;
    if (!Array.isArray(blocks)) return null;

    for (const block of blocks) {
      // MCP format: { type: 'image', source: { type: 'base64', data: '...', media_type: '...' } }
      if (block.type === 'image' && block.source?.data) {
        return {
          imageBase64: block.source.data,
          mimeType: block.source.media_type || 'image/png'
        };
      }
      // Old format: { type: 'image', data: '...', mimeType: '...' }
      if (block.type === 'image' && block.data) {
        return {
          imageBase64: block.data,
          mimeType: block.mimeType || 'image/png'
        };
      }
    }
  } catch {
    // Failed to parse JSON
  }

  return null;
}

/**
 * Check if the tool result indicates an error
 */
function isToolError(result: any, message: any): boolean {
  // Check message-level error flag
  if (message.isError) return true;

  // Check result-level isError flag (MCP response format)
  if (result?.isError === true) return true;

  return false;
}

/**
 * Extract error message from tool result
 */
function extractErrorMessage(result: any, message: any): string | null {
  // Only extract error message if there's actually an error
  if (!isToolError(result, message)) return null;

  if (message.errorMessage) {
    return message.errorMessage;
  }

  if (!result) return null;

  // Handle array of content blocks - look for error text
  if (Array.isArray(result)) {
    for (const block of result) {
      if (block.type === 'text' && typeof block.text === 'string') {
        return block.text;
      }
    }
  }

  // Handle content wrapper object
  if (result.content && Array.isArray(result.content)) {
    for (const block of result.content) {
      if (block.type === 'text' && typeof block.text === 'string') {
        return block.text;
      }
    }
  }

  // Handle direct error field
  if (result.error) {
    return typeof result.error === 'string' ? result.error : JSON.stringify(result.error);
  }

  return null;
}

export const MockupScreenshotWidget: React.FC<CustomToolWidgetProps> = ({
  message,
  workspacePath,
  readFile
}) => {
  const [showLightbox, setShowLightbox] = useState(false);
  const [loadingPersistedFile, setLoadingPersistedFile] = useState(false);
  const [persistedImageData, setPersistedImageData] = useState<{ imageBase64: string; mimeType: string } | null>(null);
  const [persistedLoadError, setPersistedLoadError] = useState<string | null>(null);

  const tool = message.toolCall;

  // Check if result is a persisted-output reference
  const isPersisted = tool ? isPersistedOutput(tool.result) : false;
  const persistedFilePath = isPersisted && tool ? extractPersistedFilePath(tool.result) : null;

  // Load image data from persisted file
  useEffect(() => {
    if (!persistedFilePath) return;
    if (!readFile) {
      setPersistedLoadError('File reading not available');
      return;
    }

    const loadPersistedFile = async () => {
      setLoadingPersistedFile(true);
      setPersistedLoadError(null);

      try {
        const result = await readFile(persistedFilePath);
        if (!result.success || !result.content) {
          throw new Error(result.error || 'Failed to read file');
        }

        const imageData = parsePersistedImageData(result.content);
        if (!imageData) {
          throw new Error('Could not parse image data from file');
        }

        setPersistedImageData(imageData);
      } catch (err) {
        setPersistedLoadError(err instanceof Error ? err.message : 'Failed to load image');
      } finally {
        setLoadingPersistedFile(false);
      }
    };

    loadPersistedFile();
  }, [persistedFilePath, readFile]);

  if (!tool) return null;

  // Extract file path from arguments and get simple name
  const filePath = tool.arguments?.file_path || tool.arguments?.filePath || '';
  const mockupName = extractMockupName(filePath);

  // Extract image data from result (either inline or from persisted file)
  const inlineImageData = extractImageData(tool.result);
  const imageData = inlineImageData || persistedImageData;

  const hasError = isToolError(tool.result, message);
  const errorMessage = extractErrorMessage(tool.result, message) || persistedLoadError;

  // Success if we have image data OR if there's no error flag set
  // (handles case where result parsing might fail but tool succeeded)
  const isSuccess = !!imageData || !hasError;

  // Build image source URL
  const imageSrc = imageData
    ? `data:${imageData.mimeType};base64,${imageData.imageBase64}`
    : null;

  // Close lightbox on Escape key
  useEffect(() => {
    if (!showLightbox) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowLightbox(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [showLightbox]);

  return (
    <div className="mockup-screenshot-widget">
      <div className="mockup-screenshot-widget__header">
        <div className="mockup-screenshot-widget__details">
          <div className="mockup-screenshot-widget__label">Viewing Mockup Image</div>
          <div className="mockup-screenshot-widget__filename" title={filePath}>
            {mockupName}
          </div>
        </div>
        {/* Loading spinner when loading from persisted file */}
        {loadingPersistedFile && (
          <div className="mockup-screenshot-widget__loading" title="Loading image...">
            <div className="mockup-screenshot-widget__spinner" />
          </div>
        )}
        {/* Thumbnail on the right if we have an image */}
        {imageSrc && !loadingPersistedFile && (
          <button
            className="mockup-screenshot-widget__header-thumbnail"
            onClick={() => setShowLightbox(true)}
            title="Click to enlarge"
          >
            <img
              src={imageSrc}
              alt={mockupName}
            />
          </button>
        )}
        {/* Show error badge if there was an error */}
        {hasError && !loadingPersistedFile && (
          <span className="mockup-screenshot-widget__status mockup-screenshot-widget__status--error">
            Failed
          </span>
        )}
      </div>

      {errorMessage && (
        <div className="mockup-screenshot-widget__error">
          {errorMessage}
        </div>
      )}

      {/* Lightbox modal */}
      {showLightbox && imageSrc && (
        <div
          className="mockup-screenshot-widget__lightbox"
          onClick={() => setShowLightbox(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Image preview"
        >
          <div
            className="mockup-screenshot-widget__lightbox-content"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="mockup-screenshot-widget__lightbox-close"
              onClick={() => setShowLightbox(false)}
              aria-label="Close (Escape)"
              title="Close (Escape)"
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path d="M15 5L5 15M5 5L15 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
            <img
              src={imageSrc}
              alt={mockupName}
              className="mockup-screenshot-widget__lightbox-image"
            />
            <div className="mockup-screenshot-widget__lightbox-caption">
              {mockupName}
              <span className="mockup-screenshot-widget__lightbox-hint">Click outside or press Escape to close</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
