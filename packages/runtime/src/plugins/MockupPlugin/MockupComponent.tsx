/**
 * MockupComponent - React component for rendering MockupNode.
 *
 * Displays the wireframe screenshot with an edit button overlay.
 * Supports resizing and selection like ImageComponent.
 */

import type { NodeKey } from 'lexical';
import type { JSX } from 'react';

import './MockupNode.css';

import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { useLexicalEditable } from '@lexical/react/useLexicalEditable';
import { useLexicalNodeSelection } from '@lexical/react/useLexicalNodeSelection';
import { mergeRegister } from '@lexical/utils';
import {
  $getNodeByKey,
  $getSelection,
  $isNodeSelection,
  CLICK_COMMAND,
  COMMAND_PRIORITY_LOW,
  SELECTION_CHANGE_COMMAND,
} from 'lexical';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';

import {
  getMockupPlatformService,
  hasMockupPlatformService,
} from './MockupPlatformService';
import { $isMockupNode } from './MockupNode';

// Simple image resizer for mockups
function MockupResizer({
  imageRef,
  onResizeStart,
  onResizeEnd,
}: {
  imageRef: React.RefObject<HTMLImageElement | null>;
  onResizeStart: () => void;
  onResizeEnd: (width: number, height: number) => void;
}): JSX.Element {
  const controlWrapperRef = useRef<HTMLDivElement>(null);
  const startX = useRef(0);
  const startY = useRef(0);
  const startWidth = useRef(0);
  const startHeight = useRef(0);
  const ratio = useRef(1);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const image = imageRef.current;
      if (!image) return;

      event.preventDefault();
      onResizeStart();

      startX.current = event.clientX;
      startY.current = event.clientY;
      startWidth.current = image.offsetWidth;
      startHeight.current = image.offsetHeight;
      ratio.current = startWidth.current / startHeight.current;

      const handlePointerMove = (moveEvent: PointerEvent) => {
        const diffX = moveEvent.clientX - startX.current;
        const newWidth = Math.max(50, startWidth.current + diffX);
        const newHeight = Math.round(newWidth / ratio.current);

        if (image) {
          image.style.width = `${newWidth}px`;
          image.style.height = `${newHeight}px`;
        }
      };

      const handlePointerUp = (upEvent: PointerEvent) => {
        document.removeEventListener('pointermove', handlePointerMove);
        document.removeEventListener('pointerup', handlePointerUp);

        const diffX = upEvent.clientX - startX.current;
        const newWidth = Math.max(50, startWidth.current + diffX);
        const newHeight = Math.round(newWidth / ratio.current);

        onResizeEnd(newWidth, newHeight);
      };

      document.addEventListener('pointermove', handlePointerMove);
      document.addEventListener('pointerup', handlePointerUp);
    },
    [imageRef, onResizeStart, onResizeEnd],
  );

  return (
    <div ref={controlWrapperRef} className="mockup-resizer">
      <div
        className="mockup-resizer-handle mockup-resizer-handle-se"
        onPointerDown={handlePointerDown}
      />
    </div>
  );
}

export default function MockupComponent({
  wireframePath,
  screenshotPath,
  altText,
  width,
  height,
  nodeKey,
  resizable,
}: {
  wireframePath: string;
  screenshotPath: string;
  altText: string;
  width: 'inherit' | number;
  height: 'inherit' | number;
  nodeKey: NodeKey;
  resizable: boolean;
}): JSX.Element {
  const imageRef = useRef<HTMLImageElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isSelected, setSelected, clearSelection] =
    useLexicalNodeSelection(nodeKey);
  const [isResizing, setIsResizing] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [isNodeSelection, setIsNodeSelection] = useState(false);
  const [editor] = useLexicalComposerContext();
  const isEditable = useLexicalEditable();
  const [resolvedScreenshotSrc, setResolvedScreenshotSrc] = useState<
    string | null
  >(null);
  const [isLoadError, setIsLoadError] = useState(false);

  // Resolve the screenshot path to an absolute URL
  useEffect(() => {
    // Empty screenshot path means still loading
    if (!screenshotPath) {
      setResolvedScreenshotSrc(null);
      return;
    }

    if (
      typeof window !== 'undefined' &&
      (window as any).__currentDocumentPath
    ) {
      const documentPath = (window as any).__currentDocumentPath;

      // If it's already an absolute URL, use as-is
      if (screenshotPath.match(/^(https?|file|data):/)) {
        setResolvedScreenshotSrc(screenshotPath);
        return;
      }

      // Resolve relative path from document directory
      const lastSlash = documentPath.lastIndexOf('/');
      const documentDir =
        lastSlash >= 0 ? documentPath.substring(0, lastSlash) : '';
      const absolutePath = documentDir + '/' + screenshotPath;
      setResolvedScreenshotSrc('file://' + absolutePath);
    } else {
      setResolvedScreenshotSrc(screenshotPath);
    }
  }, [screenshotPath]);

  // Handle click selection
  const onClick = useCallback(
    (payload: MouseEvent) => {
      const event = payload;

      if (isResizing) {
        return true;
      }

      if (
        containerRef.current &&
        containerRef.current.contains(event.target as Node)
      ) {
        if (event.shiftKey) {
          setSelected(!isSelected);
        } else {
          clearSelection();
          setSelected(true);
        }
        return true;
      }

      return false;
    },
    [isResizing, isSelected, setSelected, clearSelection],
  );

  // Register event handlers
  useEffect(() => {
    return mergeRegister(
      editor.registerCommand<MouseEvent>(
        CLICK_COMMAND,
        onClick,
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerCommand(
        SELECTION_CHANGE_COMMAND,
        () => {
          const selection = $getSelection();
          setIsNodeSelection($isNodeSelection(selection));
          return false;
        },
        COMMAND_PRIORITY_LOW,
      ),
    );
  }, [editor, onClick]);

  // Handle edit button click
  const handleEditClick = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation();
      event.preventDefault();

      if (!hasMockupPlatformService()) {
        console.warn('MockupPlatformService not available');
        return;
      }

      const service = getMockupPlatformService();

      // Resolve the wireframe path using the platform service
      let absoluteWireframePath = wireframePath;
      if (
        typeof window !== 'undefined' &&
        (window as any).__currentDocumentPath &&
        !wireframePath.startsWith('/')
      ) {
        const documentPath = (window as any).__currentDocumentPath;
        absoluteWireframePath = service.resolveRelativePath(wireframePath, documentPath);
      }

      service.openWireframeEditor(absoluteWireframePath);
    },
    [wireframePath],
  );

  // Handle resize
  const onResizeEnd = useCallback(
    (nextWidth: number, nextHeight: number) => {
      setTimeout(() => {
        setIsResizing(false);
      }, 200);

      editor.update(() => {
        const node = $getNodeByKey(nodeKey);
        if ($isMockupNode(node)) {
          node.setWidthAndHeight(nextWidth, nextHeight);
        }
      });
    },
    [editor, nodeKey],
  );

  const onResizeStart = useCallback(() => {
    setIsResizing(true);
  }, []);

  const isFocused = (isSelected || isResizing) && isEditable;
  const showEditButton = (isHovered || isSelected) && isEditable;

  if (!resolvedScreenshotSrc) {
    return (
      <div
        ref={containerRef}
        className="mockup-container mockup-loading"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <div className="mockup-placeholder">
          <span className="mockup-spinner" />
          Generating screenshot...
        </div>
        {showEditButton && (
          <button
            className="mockup-edit-button"
            onClick={handleEditClick}
            title="Edit mockup"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
            Edit
          </button>
        )}
      </div>
    );
  }

  return (
    <Suspense fallback={null}>
      <div
        ref={containerRef}
        className={`mockup-container ${isFocused ? 'focused' : ''}`}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {isLoadError ? (
          <div className="mockup-error">
            <span className="mockup-error-icon">!</span>
            <span className="mockup-error-text">Screenshot not found</span>
            <span className="mockup-error-hint">Click Edit to open the wireframe</span>
          </div>
        ) : (
          <img
            ref={imageRef}
            className={`mockup-image ${isFocused ? 'focused' : ''}`}
            src={resolvedScreenshotSrc}
            alt={altText}
            style={{
              width: width !== 'inherit' ? width : undefined,
              height: height !== 'inherit' ? height : undefined,
            }}
            onError={() => setIsLoadError(true)}
            draggable={false}
          />
        )}

        {showEditButton && (
          <button
            className="mockup-edit-button"
            onClick={handleEditClick}
            title="Edit mockup"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
            Edit
          </button>
        )}

        {resizable && isNodeSelection && isFocused && (
          <MockupResizer
            imageRef={imageRef}
            onResizeStart={onResizeStart}
            onResizeEnd={onResizeEnd}
          />
        )}
      </div>
    </Suspense>
  );
}
