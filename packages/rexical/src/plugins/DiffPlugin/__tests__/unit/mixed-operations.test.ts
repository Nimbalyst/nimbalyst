/**
 * Test for mixed ADD, REMOVE, and UPDATE operations in a single document
 */

import { describe, it, expect } from 'vitest';
import { $getRoot } from 'lexical';
import {
  $convertFromEnhancedMarkdownString,
  $convertToEnhancedMarkdownString,
  getEditorTransformers,
} from '../../../../markdown';
import { applyMarkdownReplace } from '../../core/diffUtils';
import { createTestHeadlessEditor } from '../utils/testConfig';

describe('Mixed operations test', () => {
  it('should handle adds, removes, and edits in the same document', () => {
    const editor = createTestHeadlessEditor();
    const transformers = getEditorTransformers();

    const oldMarkdown = `# Document Title

## Introduction
Welcome to our documentation. This is the first paragraph with some introductory text.

This is the second paragraph that explains the context in detail. It has multiple sentences.

## Getting Started
First, you need to install the software. Run the following command:

\`\`\`bash
npm install example-package
\`\`\`

Then, configure your environment by setting up the config file.

## Advanced Usage
For advanced users, there are additional options available. You can customize many settings.

## Troubleshooting
If you encounter issues, check the logs. The log file is located at \`/var/log/app.log\`.

## Conclusion
Thank you for reading this guide.
`;

    const newMarkdown = `# Document Title

## Introduction
Welcome to our comprehensive documentation. This is the first paragraph with some introductory text that has been expanded.

This is the second paragraph that explains the context in great detail. It has multiple sentences and examples.

We've added a new third paragraph here to provide more information about the system architecture.

## Getting Started
First, you need to install the software. Run the following command:

\`\`\`bash
npm install example-package
npm install another-dependency
\`\`\`

Then, configure your environment by setting up the config file with the proper API keys.

Next, initialize the application using the init command.

## Advanced Usage
For power users, there are many additional options available. You can customize numerous settings to fit your needs.

This section has been expanded with more details about customization options.

## Known Limitations
This is a completely new section that didn't exist before.

It contains information about current limitations of the system.

## Conclusion
Thank you for reading this comprehensive guide. We hope it was helpful!
`;

    // Setup: Load the old markdown
    editor.update(
      () => {
        const root = $getRoot();
        root.clear();
        $convertFromEnhancedMarkdownString(oldMarkdown, transformers, undefined, true, true);
      },
      { discrete: true }
    );

    // Apply the diff (single replacement of entire document)
    // LiveNodeKeyState is set automatically by applyMarkdownReplace via parallel traversal
    editor.update(
      () => {
        const original = $convertToEnhancedMarkdownString(transformers);
        applyMarkdownReplace(
          editor,
          original,
          [{ oldText: original, newText: newMarkdown }],
          transformers
        );
      },
      { discrete: true }
    );

    // Get the final markdown and check it matches expected
    let finalMarkdown = '';
    editor.getEditorState().read(() => {
      finalMarkdown = $convertToEnhancedMarkdownString(transformers);
    });

    console.log('=== FINAL MARKDOWN ===');
    console.log(finalMarkdown);

    // Check that edits were applied correctly
    expect(finalMarkdown).toContain('comprehensive documentation');
    expect(finalMarkdown).toContain('that has been expanded');
    expect(finalMarkdown).toContain('in great detail');
    expect(finalMarkdown).toContain('and examples');

    // Check that new paragraph was added
    expect(finalMarkdown).toContain("We've added a new third paragraph");
    expect(finalMarkdown).toContain('system architecture');

    // Check that code block addition worked
    expect(finalMarkdown).toContain('npm install example-package\nnpm install another-dependency');

    // Check that inline edit worked
    expect(finalMarkdown).toContain('with the proper API keys');

    // Check that new paragraph in existing section was added
    expect(finalMarkdown).toContain('Next, initialize the application');

    // Check that paragraph edit worked
    expect(finalMarkdown).toContain('For power users');
    expect(finalMarkdown).toContain('numerous settings to fit your needs');

    // Check that new paragraph in edited section was added
    expect(finalMarkdown).toContain('This section has been expanded');

    // Check that entirely new section was added
    expect(finalMarkdown).toContain('## Known Limitations');
    expect(finalMarkdown).toContain('completely new section');
    expect(finalMarkdown).toContain('current limitations of the system');

    // Check that Troubleshooting section was removed
    expect(finalMarkdown).not.toContain('## Troubleshooting');
    expect(finalMarkdown).not.toContain('check the logs');

    // Check that conclusion edit worked
    expect(finalMarkdown).toContain('comprehensive guide');
    expect(finalMarkdown).toContain('We hope it was helpful');

    // Verify section ordering is correct
    const introIndex = finalMarkdown.indexOf('## Introduction');
    const gettingStartedIndex = finalMarkdown.indexOf('## Getting Started');
    const advancedIndex = finalMarkdown.indexOf('## Advanced Usage');
    const limitationsIndex = finalMarkdown.indexOf('## Known Limitations');
    const conclusionIndex = finalMarkdown.indexOf('## Conclusion');

    expect(introIndex).toBeLessThan(gettingStartedIndex);
    expect(gettingStartedIndex).toBeLessThan(advancedIndex);
    expect(advancedIndex).toBeLessThan(limitationsIndex);
    expect(limitationsIndex).toBeLessThan(conclusionIndex);
  });
});
