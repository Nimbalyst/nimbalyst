import React, { useState, useRef, useEffect } from 'react';
import { MaterialSymbol } from '../MaterialSymbol';
import { editorRegistry } from '@nimbalyst/runtime/ai/EditorRegistry';
import { $convertFromEnhancedMarkdownString, getEditorTransformers } from 'rexical';
import { $getRoot } from 'lexical';
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

  const LOREM_IPSUM = "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.";


  const testCases: TestCase[] = [
    {
      id: 'four-headings-paragraph-diffs',
      name: 'Four Headings with Paragraph Diffs',
      icon: 'article',
      description: 'Start with four headings and paragraphs, then modify each paragraph',
      run: async (filePath: string) => {
        const editorInstance = editorRegistry.getEditor(filePath);
        if (!editorInstance) {
          throw new Error('No editor instance found');
        }

        // Set up initial content with four headings and paragraphs
        const initialContent = `# Test Document

## First Heading

This is the first paragraph with some sample text that we will modify later. It contains multiple sentences to make the changes more interesting.

## Second Heading

This is the second paragraph with different content. We will apply changes to this text as well to test the diff system.

## Third Heading

The third paragraph has its own unique text that will be modified. This helps us verify that changes work across different sections.

## Fourth Heading

Finally, the fourth paragraph completes our test structure. Each paragraph will receive targeted modifications to demonstrate the diff functionality.
`;

        await new Promise<void>(resolve => {
          editorInstance.editor.update(() => {
            const root = $getRoot();
            root.clear();
            $convertFromEnhancedMarkdownString(initialContent, getEditorTransformers(), undefined, true, true);
          }, { discrete: true, onUpdate: () => resolve() });
        });

        // Wait for content to settle
        await new Promise(resolve => setTimeout(resolve, 500));

        // Apply diffs to modify bits of each paragraph
        await editorRegistry.applyReplacements(filePath, [
          {
            oldText: 'This is the first paragraph with some sample text',
            newText: 'This is the **first** paragraph with some **modified** sample text'
          },
          {
            oldText: 'This is the second paragraph with different content',
            newText: 'This is the _second_ paragraph with _updated_ different content'
          },
          {
            oldText: 'The third paragraph has its own unique text',
            newText: 'The third paragraph has its own [CHANGED] unique text'
          },
          {
            oldText: 'Finally, the fourth paragraph completes our test structure',
            newText: 'Finally, the fourth paragraph [MODIFIED] completes our test structure'
          }
        ]);
      }
    },
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

        // Wait for initial content, then stream lorem ipsum
        await new Promise(resolve => setTimeout(resolve, 150));

        // Stream lorem ipsum text in chunks of 4 words, 10 paragraphs
        const loremWords = LOREM_IPSUM.split(' ');
        const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

        // Stream 10 paragraphs
        for (let para = 0; para < 10; para++) {
          // Add paragraph break
          editorRegistry.streamContent(filePath, testId, '\n\n');
          await delay(100);

          // Stream words in chunks of 4
          for (let i = 0; i < 10; i++) {
            const startIdx = (i * 4) % loremWords.length;
            const chunk = loremWords.slice(startIdx, startIdx + 4).join(' ') + ' ';
            editorRegistry.streamContent(filePath, testId, chunk);
            await delay(50);
          }
        }

        // End streaming after all content is sent
        editorRegistry.endStreaming(filePath, testId);
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
      id: 'paragraph-multiple-changes',
      name: 'Paragraph Multiple Changes',
      icon: 'article',
      description: 'Change two words far apart in same paragraph',
      run: async (filePath: string) => {
        let content = editorRegistry.getContent(filePath);

        // Check if we have a suitable paragraph with enough words
        const paragraphs = content.split('\n\n').filter(p => p.trim().length > 50);

        if (paragraphs.length === 0 || paragraphs[0].split(/\s+/).length < 10) {
          // Add a paragraph with plenty of words
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
                '\n\nThis is a long paragraph with many different words scattered throughout the entire sentence so that we can test multiple non-contiguous changes within the same paragraph structure.\n'
              );
            }, 50);
            setTimeout(() => {
              editorRegistry.endStreaming(filePath, testId);
              resolve(undefined);
            }, 100);
          });

          await new Promise(resolve => setTimeout(resolve, 200));
          content = editorRegistry.getContent(filePath);
        }

        // Find a paragraph with enough words
        const suitableParagraphs = content.split('\n\n').filter(p => {
          const words = p.split(/\s+/).filter(w => w.length > 3);
          return words.length >= 10;
        });

        if (suitableParagraphs.length > 0) {
          const targetParagraph = suitableParagraphs[0];
          const words = targetParagraph.split(/\s+/).filter(w => w.length > 3);

          // Change the first and last words (far apart)
          const firstWord = words[0];
          const lastWord = words[words.length - 1];

          await editorRegistry.applyReplacements(filePath, [
            {
              oldText: firstWord,
              newText: `[FIRST]${firstWord}`
            },
            {
              oldText: lastWord,
              newText: `[LAST]${lastWord}`
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
      id: 'multiple-section-headers',
      name: 'Multiple Section Headers',
      icon: 'view_headline',
      description: 'Add paragraphs under multiple section headers',
      run: async (filePath: string) => {
        const editorInstance = editorRegistry.getEditor(filePath);
        if (!editorInstance) {
          throw new Error('No editor instance found');
        }

        // First, set content directly using markdown conversion (not using diff)
        const headersOnly = '# Test Doc\n\n## Section One\n\n## Section Two\n';

        await new Promise<void>(resolve => {
          editorInstance.editor.update(() => {
            const root = $getRoot();
            root.clear();
            // Import markdown using enhanced conversion
            $convertFromEnhancedMarkdownString(headersOnly, getEditorTransformers(), undefined, true, true);
          }, { discrete: true, onUpdate: () => resolve() });
        });

        // Wait for content to settle
        await new Promise(resolve => setTimeout(resolve, 500));

        // Now apply diff to add paragraph under Section One
        await editorRegistry.applyReplacements(filePath, [
          { oldText: '## Section One\n\n', newText: '## Section One\nFirst paragraph.\n' }
        ]);

        // Wait a bit
        await new Promise(resolve => setTimeout(resolve, 500));

        // Then apply diff to add paragraph under Section Two
        const currentContent = editorRegistry.getContent(filePath);
        if (currentContent.includes('## Section Two\n')) {
          await editorRegistry.applyReplacements(filePath, [
            { oldText: '## Section Two\n', newText: '## Section Two\nSecond paragraph.\n' }
          ]);
        } else if (currentContent.includes('## Section Two')) {
          await editorRegistry.applyReplacements(filePath, [
            { oldText: '## Section Two', newText: '## Section Two\nSecond paragraph.' }
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
