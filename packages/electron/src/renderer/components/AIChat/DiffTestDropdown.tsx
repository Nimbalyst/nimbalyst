import React, { useState, useRef, useEffect } from 'react';
import { MaterialSymbol } from '../MaterialSymbol';
import { editorRegistry } from '@nimbalyst/runtime/ai/EditorRegistry';
import './DiffTestDropdown.css';

interface DiffTestDropdownProps {
  documentContext?: { filePath?: string } | null;
}

interface TestCase {
  id: string;
  name: string;
  icon: string;
  description: string;
  run: (filePath: string) => Promise<void>;
}

export function DiffTestDropdown({ documentContext }: DiffTestDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{ top: number; right: number } | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Calculate menu position when opening
  const handleToggle = () => {
    if (!isOpen && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      // Position menu so its right edge aligns with button's right edge
      setMenuPosition({
        top: rect.bottom + 4,
        right: window.innerWidth - rect.right // Distance from right edge of viewport
      });
    }
    setIsOpen(!isOpen);
  };

  const testCases: TestCase[] = [
    {
      id: 'stream-end',
      name: 'Stream at End',
      icon: 'stream',
      description: 'Stream new content to the end of the document',
      run: async (filePath: string) => {
        const testId = 'test-stream-' + Date.now();
        editorRegistry.startStreaming(filePath, {
          id: testId,
          insertAtEnd: true
        });

        setTimeout(() => {
          editorRegistry.streamContent(filePath, testId, '\n\n## Streamed Section\n\n');
        }, 50);

        setTimeout(() => {
          editorRegistry.streamContent(filePath, testId, 'This content was streamed to the end of the document.\n\n');
        }, 100);

        setTimeout(() => {
          editorRegistry.endStreaming(filePath, testId);
        }, 150);
      }
    },
    {
      id: 'stream-cursor',
      name: 'Stream at Cursor',
      icon: 'edit_note',
      description: 'Stream content at the current cursor position',
      run: async (filePath: string) => {
        const testId = 'test-stream-cursor-' + Date.now();
        editorRegistry.startStreaming(filePath, {
          id: testId,
          position: 'cursor'
        });

        setTimeout(() => {
          editorRegistry.streamContent(filePath, testId, ' [INSERTED] ');
        }, 50);

        setTimeout(() => {
          editorRegistry.endStreaming(filePath, testId);
        }, 100);
      }
    },
    {
      id: 'simple-replace',
      name: 'Simple Replace',
      icon: 'find_replace',
      description: 'Replace a single word or phrase',
      run: async (filePath: string) => {
        let content = editorRegistry.getContent(filePath);
        const words = content.split(/\s+/).filter(w => w.length > 3);

        // If no suitable words, add some content first
        if (words.length === 0) {
          const testId = 'setup-' + Date.now();
          editorRegistry.startStreaming(filePath, {
            id: testId,
            insertAtEnd: true
          });

          await new Promise(resolve => {
            setTimeout(() => {
              editorRegistry.streamContent(filePath, testId, '\n\nThis is sample text for testing replacements.\n');
            }, 50);
            setTimeout(() => {
              editorRegistry.endStreaming(filePath, testId);
              resolve(undefined);
            }, 100);
          });

          // Wait a bit for content to settle, then try again
          await new Promise(resolve => setTimeout(resolve, 200));
          content = editorRegistry.getContent(filePath);
        }

        // Now find and replace a word
        const updatedWords = content.split(/\s+/).filter(w => w.length > 3);
        if (updatedWords.length > 0) {
          const targetWord = updatedWords[0];
          await editorRegistry.applyReplacements(filePath, [
            {
              oldText: targetWord,
              newText: targetWord.toUpperCase()
            }
          ]);
        }
      }
    },
    {
      id: 'multiple-paragraph',
      name: 'Multi-Paragraph Edits',
      icon: 'view_agenda',
      description: 'Make changes across multiple paragraphs',
      run: async (filePath: string) => {
        let content = editorRegistry.getContent(filePath);
        let paragraphs = content.split('\n\n').filter(p => p.trim().length > 10);

        // If not enough paragraphs, add some
        if (paragraphs.length < 2) {
          const testId = 'setup-' + Date.now();
          editorRegistry.startStreaming(filePath, {
            id: testId,
            insertAtEnd: true
          });

          await new Promise(resolve => {
            setTimeout(() => {
              editorRegistry.streamContent(
                filePath,
                testId,
                '\n\nFirst paragraph with some sample text for testing multi-paragraph edits.\n\nSecond paragraph with different content for testing modifications.\n'
              );
            }, 50);
            setTimeout(() => {
              editorRegistry.endStreaming(filePath, testId);
              resolve(undefined);
            }, 100);
          });

          // Wait for content to settle
          await new Promise(resolve => setTimeout(resolve, 200));
          content = editorRegistry.getContent(filePath);
          paragraphs = content.split('\n\n').filter(p => p.trim().length > 10);
        }

        const replacements = [];

        // Modify first paragraph
        if (paragraphs[0]) {
          const firstWords = paragraphs[0].split(/\s+/).slice(0, 3).join(' ');
          if (firstWords) {
            replacements.push({
              oldText: firstWords,
              newText: `**${firstWords}**`
            });
          }
        }

        // Modify second paragraph
        if (paragraphs[1]) {
          const secondWords = paragraphs[1].split(/\s+/).slice(0, 3).join(' ');
          if (secondWords) {
            replacements.push({
              oldText: secondWords,
              newText: `_${secondWords}_`
            });
          }
        }

        if (replacements.length > 0) {
          await editorRegistry.applyReplacements(filePath, replacements);
        }
      }
    },
    {
      id: 'list-modification',
      name: 'List Item Changes',
      icon: 'format_list_bulleted',
      description: 'Add and modify list items',
      run: async (filePath: string) => {
        const content = editorRegistry.getContent(filePath);

        // Look for existing list items
        const listPattern = /^[-*+]\s+(.+)$/m;
        const match = content.match(listPattern);

        if (match) {
          // Modify existing list item
          await editorRegistry.applyReplacements(filePath, [
            {
              oldText: match[0],
              newText: `${match[0]} (MODIFIED)`
            }
          ]);
        } else {
          // Add a new list
          const testId = 'test-list-' + Date.now();
          editorRegistry.startStreaming(filePath, {
            id: testId,
            insertAtEnd: true
          });

          setTimeout(() => {
            editorRegistry.streamContent(filePath, testId, '\n\n## New List\n\n- Item 1\n- Item 2\n- Item 3\n');
          }, 50);

          setTimeout(() => {
            editorRegistry.endStreaming(filePath, testId);
          }, 100);
        }
      }
    },
    {
      id: 'code-block',
      name: 'Code Block Edit',
      icon: 'code',
      description: 'Modify content within a code block',
      run: async (filePath: string) => {
        const content = editorRegistry.getContent(filePath);
        const codeBlockPattern = /```[\s\S]*?```/;
        const match = content.match(codeBlockPattern);

        if (match) {
          const codeBlock = match[0];
          const lines = codeBlock.split('\n');
          if (lines.length > 2) {
            // Modify a line in the middle of the code block
            const middleLine = lines[Math.floor(lines.length / 2)];
            await editorRegistry.applyReplacements(filePath, [
              {
                oldText: middleLine,
                newText: `${middleLine} // MODIFIED`
              }
            ]);
          }
        } else {
          // Add a code block
          const testId = 'test-code-' + Date.now();
          editorRegistry.startStreaming(filePath, {
            id: testId,
            insertAtEnd: true
          });

          setTimeout(() => {
            editorRegistry.streamContent(
              filePath,
              testId,
              '\n\n```javascript\nfunction test() {\n  console.log("Hello");\n}\n```\n'
            );
          }, 50);

          setTimeout(() => {
            editorRegistry.endStreaming(filePath, testId);
          }, 100);
        }
      }
    },
    {
      id: 'heading-changes',
      name: 'Heading Modifications',
      icon: 'title',
      description: 'Modify document headings',
      run: async (filePath: string) => {
        let content = editorRegistry.getContent(filePath);
        const headingPattern = /^(#{1,6})\s+(.+)$/m;
        let match = content.match(headingPattern);

        // If no headings, add one first
        if (!match) {
          const testId = 'setup-' + Date.now();
          editorRegistry.startStreaming(filePath, {
            id: testId,
            insertAtEnd: true
          });

          await new Promise(resolve => {
            setTimeout(() => {
              editorRegistry.streamContent(
                filePath,
                testId,
                '\n\n## Sample Heading\n\nContent under the heading.\n'
              );
            }, 50);
            setTimeout(() => {
              editorRegistry.endStreaming(filePath, testId);
              resolve(undefined);
            }, 100);
          });

          // Wait for content to settle
          await new Promise(resolve => setTimeout(resolve, 200));
          content = editorRegistry.getContent(filePath);
          match = content.match(headingPattern);
        }

        if (match) {
          await editorRegistry.applyReplacements(filePath, [
            {
              oldText: match[0],
              newText: `${match[1]} ${match[2]} (Updated)`
            }
          ]);
        }
      }
    },
    {
      id: 'stress-test',
      name: 'Stress Test (10 Changes)',
      icon: 'warning',
      description: 'Apply 10 different changes at once',
      run: async (filePath: string) => {
        let content = editorRegistry.getContent(filePath);
        let words = content.split(/\s+/).filter(w => w.length > 3);

        // If not enough words, add some content first
        if (words.length < 10) {
          const testId = 'setup-' + Date.now();
          editorRegistry.startStreaming(filePath, {
            id: testId,
            insertAtEnd: true
          });

          await new Promise(resolve => {
            setTimeout(() => {
              editorRegistry.streamContent(
                filePath,
                testId,
                '\n\n## Stress Test Content\n\nThis paragraph contains enough words to perform a comprehensive stress test with multiple simultaneous replacements across different parts of the document.\n\nAnother paragraph with additional content to ensure we have sufficient text for testing multiple concurrent modifications.\n'
              );
            }, 50);
            setTimeout(() => {
              editorRegistry.endStreaming(filePath, testId);
              resolve(undefined);
            }, 100);
          });

          // Wait for content to settle
          await new Promise(resolve => setTimeout(resolve, 200));
          content = editorRegistry.getContent(filePath);
          words = content.split(/\s+/).filter(w => w.length > 3);
        }

        const replacements = [];
        for (let i = 0; i < Math.min(10, words.length); i++) {
          const word = words[i];
          replacements.push({
            oldText: word,
            newText: `[${i + 1}]${word}`
          });
        }

        await editorRegistry.applyReplacements(filePath, replacements);
      }
    }
  ];

  const handleRunTest = async (testCase: TestCase) => {
    const filePath = documentContext?.filePath;

    if (!filePath) {
      alert('No file is currently open');
      return;
    }

    if (!editorRegistry.has(filePath)) {
      alert('Editor not registered for this file');
      return;
    }

    try {
      console.log(`[DiffTest] Running: ${testCase.name}`);
      await testCase.run(filePath);
      console.log(`[DiffTest] Completed: ${testCase.name}`);
    } catch (error) {
      console.error(`[DiffTest] Error running ${testCase.name}:`, error);
      alert(`Test failed: ${error}`);
    }

    setIsOpen(false);
  };

  return (
    <div className="diff-test-dropdown" ref={dropdownRef}>
      <button
        ref={triggerRef}
        className="ai-chat-action-button diff-test-trigger"
        onClick={handleToggle}
        title="Diff Test Cases (Debug)"
        aria-label="Open Diff Tests"
        style={{ backgroundColor: '#4c6ef5', color: 'white' }}
      >
        <MaterialSymbol icon="science" size={18} />
      </button>

      {isOpen && menuPosition && (
        <div
          className="diff-test-menu"
          style={{
            position: 'fixed',
            top: `${menuPosition.top}px`,
            right: `${menuPosition.right}px`
          }}
        >
          <div className="diff-test-menu-header">
            <MaterialSymbol icon="science" size={16} />
            <span>Diff Test Cases</span>
          </div>

          <div className="diff-test-menu-list">
            {testCases.map(testCase => (
              <button
                key={testCase.id}
                className="diff-test-menu-item"
                onClick={() => handleRunTest(testCase)}
              >
                <div className="diff-test-item-icon">
                  <MaterialSymbol icon={testCase.icon} size={18} />
                </div>
                <div className="diff-test-item-content">
                  <div className="diff-test-item-name">{testCase.name}</div>
                  <div className="diff-test-item-description">{testCase.description}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
