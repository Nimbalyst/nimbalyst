/**
 * Custom widget for the capture_mockup_screenshot MCP tool
 *
 * Displays a preview of the captured mockup screenshot with:
 * - Thumbnail image preview (click to enlarge)
 * - File path information
 * - Success/error status badge
 * - Full-size lightbox modal
 */

import React, { useState } from 'react';
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
  workspacePath
}) => {
  const [showLightbox, setShowLightbox] = useState(false);

  const tool = message.toolCall;
  if (!tool) return null;

  // DEBUG: Log the tool result structure to understand what we're getting
  const firstEl = Array.isArray(tool.result) ? tool.result[0] : null;
  console.log('[MockupScreenshotWidget] Tool result - firstElement keys:', firstEl ? Object.keys(firstEl) : 'no first element');
  console.log('[MockupScreenshotWidget] Tool result - firstElement type:', firstEl?.type);
  console.log('[MockupScreenshotWidget] Tool result - firstElement has data:', !!firstEl?.data);
  console.log('[MockupScreenshotWidget] Tool result - firstElement has source:', !!firstEl?.source);

  // Extract file path from arguments and get simple name
  const filePath = tool.arguments?.file_path || tool.arguments?.filePath || '';
  const mockupName = extractMockupName(filePath);

  // Extract image data from result
  const imageData = extractImageData(tool.result);
  const hasError = isToolError(tool.result, message);
  const errorMessage = extractErrorMessage(tool.result, message);

  // DEBUG: Log extraction results
  console.log('[MockupScreenshotWidget] Extraction results:', {
    imageData: imageData ? 'found' : 'null',
    hasError,
    errorMessage,
  });

  // Success if we have image data OR if there's no error flag set
  // (handles case where result parsing might fail but tool succeeded)
  const isSuccess = !!imageData || !hasError;
  const statusLabel = isSuccess ? 'Captured' : 'Failed';

  // Build image source URL
  const imageSrc = imageData
    ? `data:${imageData.mimeType};base64,${imageData.imageBase64}`
    : null;

  return (
    <div className="mockup-screenshot-widget">
      <div className="mockup-screenshot-widget__header">
        <div className="mockup-screenshot-widget__details">
          <div className="mockup-screenshot-widget__label">Viewing Mockup Image</div>
          <div className="mockup-screenshot-widget__filename" title={filePath}>
            {mockupName}
          </div>
        </div>
        {/* Thumbnail on the right if we have an image */}
        {imageSrc && (
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
        {hasError && (
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
        >
          <div
            className="mockup-screenshot-widget__lightbox-content"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="mockup-screenshot-widget__lightbox-close"
              onClick={() => setShowLightbox(false)}
              aria-label="Close"
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
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
