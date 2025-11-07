import {describe, expect, it} from 'vitest';
import {$getRoot, $isElementNode} from 'lexical';
import {
  $convertFromEnhancedMarkdownString,
  $convertToEnhancedMarkdownString,
  getEditorTransformers,
} from '../../../../markdown';
import {applyMarkdownReplace} from '../../core/diffUtils';
import {$getDiffState} from '../../core/DiffState';
import {createTestHeadlessEditor} from '../../utils/testConfig';
import {getAllNodes} from '../utils';

describe('Heading change in large document', () => {
  it('should handle apostrophe addition to first heading in large doc', () => {
    // Source markdown - larger document
    const sourceMarkdown = `# Main Title

Introduction paragraph.

## Section One

Content for section one.

- Item 1
- Item 2
- Item 3

## Section Two

Content for section two.

### Subsection A

More content here.

### Subsection B

Even more content.

## Section Three

Final section content.

- Point A
- Point B
- Point C

## Section Four

Last section.
`;

    // Target markdown - just add apostrophe to first heading
    const targetMarkdown = `# Main Title's

Introduction paragraph.

## Section One

Content for section one.

- Item 1
- Item 2
- Item 3

## Section Two

Content for section two.

### Subsection A

More content here.

### Subsection B

Even more content.

## Section Three

Final section content.

- Point A
- Point B
- Point C

## Section Four

Last section.
`;

    // Create editor and load source
    const editor = createTestHeadlessEditor();
    const transformers = getEditorTransformers();

    editor.update(
      () => {
        const root = $getRoot();
        root.clear();
        $convertFromEnhancedMarkdownString(sourceMarkdown, transformers);
      },
      {discrete: true},
    );

    // Apply diff
    editor.update(
      () => {
        const original = $convertToEnhancedMarkdownString(transformers);
        applyMarkdownReplace(
          editor,
          original,
          [{oldText: sourceMarkdown, newText: targetMarkdown}],
          transformers
        );
      },
      {discrete: true},
    );

    // Collect diff states with positions
    const result = editor.getEditorState().read(() => {
      const root = $getRoot();
      const allChildren = root.getChildren();

      const states = {
        added: [] as Array<{text: string, type: string, position: number}>,
        removed: [] as Array<{text: string, type: string, position: number}>,
        modified: [] as Array<{text: string, type: string, position: number}>,
      };

      allChildren.forEach((node, index) => {
        if (!$isElementNode(node)) return;

        const state = $getDiffState(node);
        const text = node.getTextContent().trim();
        const type = node.getType();

        if (!text) return;

        if (state === 'added') {
          states.added.push({text, type, position: index});
        } else if (state === 'removed') {
          states.removed.push({text, type, position: index});
        } else if (state === 'modified') {
          states.modified.push({text, type, position: index});
        }
      });

      return states;
    });

    console.log('=== Large Document Heading Change Results ===');
    console.log('Added:', result.added);
    console.log('Removed:', result.removed);
    console.log('Modified:', result.modified);

    const removedHeadings = result.removed.filter(n => n.type === 'heading');
    const addedHeadings = result.added.filter(n => n.type === 'heading');

    console.log('\n=== Heading Changes ===');
    console.log('Removed headings:', removedHeadings);
    console.log('Added headings:', addedHeadings);

    // Check positions
    if (removedHeadings.length > 0) {
      console.log('\nRemoved heading positions:', removedHeadings.map(h => h.position));
    }
    if (addedHeadings.length > 0) {
      console.log('Added heading positions:', addedHeadings.map(h => h.position));
    }

    // Expected: Only the first heading should change
    expect(removedHeadings.length, 'Should have exactly 1 removed heading').toBe(1);
    expect(addedHeadings.length, 'Should have exactly 1 added heading').toBe(1);

    // Check that it's the right heading
    expect(removedHeadings[0].text).toContain('Main Title');
    expect(addedHeadings[0].text).toContain("Main Title's");

    // Check positions - they should be close to each other (at the start)
    const removedPos = removedHeadings[0].position;
    const addedPos = addedHeadings[0].position;

    console.log(`\nPosition difference: ${Math.abs(removedPos - addedPos)}`);

    // They should be adjacent or very close
    expect(Math.abs(removedPos - addedPos), 'Removed and added should be adjacent').toBeLessThanOrEqual(2);

    // Both should be near the start of the document
    expect(removedPos, 'Removed heading should be at start').toBeLessThan(5);
    expect(addedPos, 'Added heading should be at start').toBeLessThan(5);

    // Check that other sections are NOT affected
    const otherRemoved = result.removed.filter(n =>
      n.text.includes('Section One') ||
      n.text.includes('Section Two') ||
      n.text.includes('Section Three') ||
      n.text.includes('Section Four')
    );

    expect(otherRemoved.length, 'Other sections should not be removed').toBe(0);
  });
});
