/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

import {
  setupMarkdownReplaceTest,
  assertApproveProducesTarget as assertApproveProducesTargetReplace,
  assertRejectProducesOriginal as assertRejectProducesOriginalReplace,
  getAllNodes,
} from '../utils/replaceTestUtils';

describe('Markdown Diff - Code Changes', () => {
  test('Simple code block content change', () => {
    const originalMarkdown = `Here is a code example:

\`\`\`javascript
function hello() {
  console.log("Hello World");
}
\`\`\`

That's the example.`;

    const replacements = [
      {
        oldText: `\`\`\`javascript
function hello() {
  console.log("Hello World");
}
\`\`\``,
        newText: `\`\`\`javascript
function hello() {
  console.log("Hello Updated World");
}
\`\`\``,
      },
    ];

    const result = setupMarkdownReplaceTest(originalMarkdown, replacements);

    // Check that we have a code block node that was updated
    const allNodes = getAllNodes(result.replaceEditor);
    const codeNodes = allNodes.filter((node) => node.getType() === 'code');
    expect(codeNodes.length).toBeGreaterThan(0);

    // Test that approving produces the target and rejecting produces the original
    assertApproveProducesTargetReplace(result);
    assertRejectProducesOriginalReplace(result);
  });

  test('Complex code enhancement with formatting changes', () => {
    const originalMarkdown = `# Code Example

Here's some code:

\`\`\`javascript
function hello() {
    console.log("Hello World");
}
\`\`\`

And some text after.`;

    const replacements = [
      {
        oldText: '# Code Example',
        newText: '# Enhanced Code Example',
      },
      {
        oldText: "Here's some code:",
        newText: "Here's the **improved** code:",
      },
      {
        oldText: `\`\`\`javascript
function hello() {
    console.log("Hello World");
}
\`\`\``,
        newText: `\`\`\`javascript
function enhancedHello(name = "World") {
    console.log(\`Hello \${name}!\`);
    return \`Greeting sent to \${name}\`;
}

// Usage example
const result = enhancedHello("Developer");
console.log(result);
\`\`\``,
      },
      {
        oldText: 'And some text after.',
        newText: 'And some *enhanced* text after with **better** formatting.',
      },
    ];

    const result = setupMarkdownReplaceTest(originalMarkdown, replacements);

    // Check that we have the enhanced code block
    const allNodes = getAllNodes(result.replaceEditor);
    const codeNodes = allNodes.filter((node) => node.getType() === 'code');
    expect(codeNodes.length).toBeGreaterThan(0);

    // Test that approving produces the target and rejecting produces the original
    assertApproveProducesTargetReplace(result);
    assertRejectProducesOriginalReplace(result);
  });
});
