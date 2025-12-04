/**
 * MockupPickerMenu - A typeahead submenu for selecting or creating mockups.
 *
 * This appears as a floating menu when user selects "Mockup" from the component picker.
 * Shows "New Mockup" at top + list of existing wireframes.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getMockupPlatformService,
  hasMockupPlatformService,
  generateMockupScreenshot,
  INSERT_MOCKUP_COMMAND,
  type WireframeFileInfo,
  type MockupPayload,
} from '@nimbalyst/runtime';
import { $getRoot } from 'lexical';
import type { LexicalEditor } from 'lexical';

import './MockupPickerMenu.css';

interface MockupPickerMenuProps {
  onClose: () => void;
}

// Singleton state for the picker
let showPickerCallback: ((props: MockupPickerMenuProps) => void) | null = null;
let hidePickerCallback: (() => void) | null = null;

/**
 * Show the mockup picker menu.
 * Called by the MockupPlugin when INSERT_MOCKUP_COMMAND is dispatched without payload.
 */
export function showMockupPickerMenu(): void {
  if (showPickerCallback) {
    showPickerCallback({ onClose: () => hidePickerCallback?.() });
  } else {
    console.warn('[MockupPickerMenu] Picker not mounted');
  }
}

/**
 * MockupPickerMenuHost - Renders the picker when triggered.
 * Mount this once in your app to enable the mockup picker.
 */
export function MockupPickerMenuHost(): JSX.Element | null {
  const [isOpen, setIsOpen] = useState(false);
  const [props, setProps] = useState<MockupPickerMenuProps | null>(null);

  useEffect(() => {
    showPickerCallback = (p) => {
      setProps(p);
      setIsOpen(true);
    };
    hidePickerCallback = () => {
      setIsOpen(false);
      setProps(null);
    };

    return () => {
      showPickerCallback = null;
      hidePickerCallback = null;
    };
  }, []);

  if (!isOpen || !props) {
    return null;
  }

  return <MockupPickerMenu onClose={props.onClose} />;
}

function MockupPickerMenu({ onClose }: MockupPickerMenuProps): JSX.Element {
  const [wireframes, setWireframes] = useState<WireframeFileInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const [newName, setNewName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Load wireframe files
  useEffect(() => {
    async function loadWireframes() {
      if (!hasMockupPlatformService()) {
        setIsLoading(false);
        return;
      }

      try {
        const service = getMockupPlatformService();
        const files = await service.listWireframeFiles();
        setWireframes(files);
      } catch (error) {
        console.error('[MockupPickerMenu] Failed to load wireframes:', error);
      } finally {
        setIsLoading(false);
      }
    }

    loadWireframes();
  }, []);

  // Focus input on initial mount
  useEffect(() => {
    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  }, []);

  // Focus input when switching between search and create modes
  useEffect(() => {
    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  }, [isCreatingNew]);

  // Close on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  // Filter wireframes by search
  const filteredWireframes = wireframes.filter(
    (wf) =>
      wf.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      wf.relativePath.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Options: "New Mockup" + filtered wireframes
  const options = [
    { id: 'new', label: '+ New Mockup', isNew: true },
    ...filteredWireframes.map((wf) => ({
      id: wf.absolutePath,
      label: wf.name,
      description: wf.relativePath,
      isNew: false,
      wireframe: wf,
    })),
  ];

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (isCreatingNew) {
        if (e.key === 'Escape') {
          setIsCreatingNew(false);
          setNewName('');
        } else if (e.key === 'Enter' && newName.trim()) {
          handleCreateNew(newName.trim());
        }
        return;
      }

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((prev) => Math.min(prev + 1, options.length - 1));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((prev) => Math.max(prev - 1, 0));
          break;
        case 'Enter':
          e.preventDefault();
          handleSelect(options[selectedIndex]);
          break;
        case 'Escape':
          onClose();
          break;
      }
    },
    [options, selectedIndex, isCreatingNew, newName, onClose]
  );

  // Handle selection
  const handleSelect = useCallback(
    (option: (typeof options)[0]) => {
      if (option.isNew) {
        setIsCreatingNew(true);
      } else if ('wireframe' in option && option.wireframe) {
        handleInsertExisting(option.wireframe);
      }
    },
    []
  );

  // Create new wireframe
  async function handleCreateNew(name: string) {
    if (!hasMockupPlatformService()) return;

    const documentPath = (window as any).__currentDocumentPath;
    if (!documentPath) {
      console.warn('[MockupPickerMenu] No document open');
      onClose();
      return;
    }

    try {
      const service = getMockupPlatformService();
      const documentDir = documentPath.substring(0, documentPath.lastIndexOf('/'));
      const wireframePath = await service.createWireframeFile(name, documentDir);
      const relativeWireframePath = service.getRelativePath(documentPath, wireframePath);

      // Insert node immediately with empty screenshot (shows loading state)
      dispatchInsertCommand({
        wireframePath: relativeWireframePath,
        screenshotPath: '', // Empty - will show loading state
        altText: name,
      });

      // Close menu immediately for snappy UX
      onClose();

      // Open for editing
      service.openWireframeEditor(wireframePath);

      // Generate screenshot in background and update node
      generateMockupScreenshot(wireframePath, documentPath).then(({ screenshotPath }: { screenshotPath: string }) => {
        updateNodeScreenshotByPath(relativeWireframePath, screenshotPath);
      }).catch((error: Error) => {
        console.error('[MockupPickerMenu] Failed to generate screenshot:', error);
        // Even if screenshot generation fails, set an expected path so the image can load if it exists
        const expectedScreenshotPath = `assets/${name}.wireframe.png`;
        updateNodeScreenshotByPath(relativeWireframePath, expectedScreenshotPath);
      });
    } catch (error) {
      console.error('[MockupPickerMenu] Failed to create mockup:', error);
    }
  }

  // Insert existing wireframe
  async function handleInsertExisting(wireframe: WireframeFileInfo) {
    if (!hasMockupPlatformService()) return;

    const documentPath = (window as any).__currentDocumentPath;
    if (!documentPath) {
      console.warn('[MockupPickerMenu] No document open');
      onClose();
      return;
    }

    try {
      const service = getMockupPlatformService();
      const relativeWireframePath = service.getRelativePath(documentPath, wireframe.absolutePath);

      // Insert node immediately with empty screenshot (shows loading state)
      dispatchInsertCommand({
        wireframePath: relativeWireframePath,
        screenshotPath: '', // Empty - will show loading state
        altText: wireframe.name,
      });

      // Close menu immediately for snappy UX
      onClose();

      // Generate screenshot in background and update node
      generateMockupScreenshot(wireframe.absolutePath, documentPath).then(({ screenshotPath }: { screenshotPath: string }) => {
        updateNodeScreenshotByPath(relativeWireframePath, screenshotPath);
      }).catch((error: Error) => {
        console.error('[MockupPickerMenu] Failed to generate screenshot:', error);
        // Even if screenshot generation fails, check if an existing screenshot exists
        // and update the node with a placeholder or error state
        const expectedScreenshotPath = `assets/${wireframe.name}.wireframe.png`;
        updateNodeScreenshotByPath(relativeWireframePath, expectedScreenshotPath);
      });
    } catch (error) {
      console.error('[MockupPickerMenu] Failed to insert mockup:', error);
    }
  }

  // Get the editor instance for the current document
  function getEditor(): LexicalEditor | null {
    const documentPath = (window as any).__currentDocumentPath;
    const editorRegistry = (window as any).__editorRegistry;
    if (editorRegistry && documentPath) {
      const editorInstance = editorRegistry.getEditor(documentPath);
      return editorInstance?.editor || null;
    }
    return null;
  }

  // Insert mockup node into the active editor
  // Returns a function that can be called later to find the node key
  function dispatchInsertCommand(payload: { wireframePath: string; screenshotPath: string; altText: string }): string | null {
    const editor = getEditor();
    if (!editor) return null;

    // Dispatch the command to insert the node
    editor.dispatchCommand(INSERT_MOCKUP_COMMAND, payload as MockupPayload);

    // The node key will be found asynchronously after the editor updates
    // We return the wireframePath as identifier since it's unique
    return payload.wireframePath;
  }

  // Find the mockup node by wireframePath and update its screenshot
  function updateNodeScreenshotByPath(wireframePath: string, screenshotPath: string) {
    const editor = getEditor();
    if (!editor) {
      console.warn('[MockupPickerMenu] No editor found for update');
      return;
    }

    console.log('[MockupPickerMenu] Attempting to update node with wireframePath:', wireframePath);

    editor.update(() => {
      const root = $getRoot();
      let found = false;
      const findAndUpdate = (node: { getType: () => string; getWireframePath?: () => string; setScreenshotPath?: (path: string) => void; getChildren?: () => { getType: () => string; getWireframePath?: () => string; setScreenshotPath?: (path: string) => void }[] }) => {
        if (node.getType() === 'mockup') {
          const nodePath = node.getWireframePath ? node.getWireframePath() : 'N/A';
          console.log('[MockupPickerMenu] Found mockup node with path:', nodePath);
          if (node.getWireframePath && node.getWireframePath() === wireframePath) {
            if (node.setScreenshotPath) {
              console.log('[MockupPickerMenu] Updating screenshot for:', wireframePath, '->', screenshotPath);
              node.setScreenshotPath(screenshotPath);
              found = true;
            }
            return true;
          }
        }
        if (node.getChildren) {
          for (const child of node.getChildren()) {
            if (findAndUpdate(child)) return true;
          }
        }
        return false;
      };
      root.getChildren().forEach(findAndUpdate);
      if (!found) {
        console.warn('[MockupPickerMenu] Could not find mockup node with wireframePath:', wireframePath);
      }
    });
  }

  // Reset selected index when search changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [searchQuery]);

  return (
    <div className="mockup-picker-overlay">
      <div ref={menuRef} className="mockup-picker-menu" onKeyDown={handleKeyDown}>
        {isCreatingNew ? (
          <div className="mockup-picker-create">
            <input
              ref={inputRef}
              type="text"
              className="mockup-picker-input"
              placeholder="Enter mockup name..."
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              autoFocus
            />
            <div className="mockup-picker-create-hint">Press Enter to create, Escape to cancel</div>
          </div>
        ) : (
          <>
            <input
              ref={inputRef}
              type="text"
              className="mockup-picker-input"
              placeholder="Search mockups..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <div className="mockup-picker-list">
              {isLoading ? (
                <div className="mockup-picker-loading">Loading...</div>
              ) : (
                options.map((option, index) => (
                  <div
                    key={option.id}
                    className={`mockup-picker-item ${index === selectedIndex ? 'selected' : ''} ${option.isNew ? 'new-item' : ''}`}
                    onClick={() => handleSelect(option)}
                    onMouseEnter={() => setSelectedIndex(index)}
                  >
                    <span className="mockup-picker-item-label">{option.label}</span>
                    {'description' in option && option.description && (
                      <span className="mockup-picker-item-desc">{option.description}</span>
                    )}
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
