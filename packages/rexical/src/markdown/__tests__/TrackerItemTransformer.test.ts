/**
 * Unit tests for TrackerItemTransformer
 * Tests markdown import/export round-tripping for tracker items,
 * including description handling.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createEditor, $getRoot } from 'lexical';
import { ListNode, ListItemNode } from '@lexical/list';
import { HeadingNode, QuoteNode } from '@lexical/rich-text';
import { CodeNode } from '@lexical/code';
import { LinkNode } from '@lexical/link';
import { $convertToMarkdownString, Transformer } from '@lexical/markdown';
import { $convertFromEnhancedMarkdownString } from '../EnhancedMarkdownImport';
import { CORE_TRANSFORMERS } from '../core-transformers';
// Import tracker items from runtime package using relative path
import { TrackerItemNode, $isTrackerItemNode } from '../../../../runtime/src/plugins/TrackerPlugin/TrackerItemNode';
import { TRACKER_ITEM_TRANSFORMERS } from '../../../../runtime/src/plugins/TrackerPlugin/TrackerItemTransformer';

// Combine tracker and core transformers for tests
function getTestTransformers(): Transformer[] {
  return [...TRACKER_ITEM_TRANSFORMERS, ...CORE_TRANSFORMERS];
}

describe('TrackerItemTransformer', () => {
  let editor: ReturnType<typeof createEditor>;

  beforeEach(() => {
    editor = createEditor({
      nodes: [
        HeadingNode,
        QuoteNode,
        ListNode,
        ListItemNode,
        CodeNode,
        LinkNode,
        TrackerItemNode,
      ],
      onError: console.error,
    });
  });

  describe('basic import/export', () => {
    it('should import a simple tracker item without description', () => {
      const markdown = `Fix the login bug #bug[id:bug_123 status:to-do]`;

      editor.update(() => {
        $convertFromEnhancedMarkdownString(markdown, getTestTransformers());
      });

      // Read synchronously after update
      editor.read(() => {
        const root = $getRoot();
        const children = root.getChildren();

        expect(children.length).toBe(1);
        expect($isTrackerItemNode(children[0])).toBe(true);

        const trackerNode = children[0] as TrackerItemNode;
        const data = trackerNode.getData();

        expect(data.type).toBe('bug');
        expect(data.id).toBe('bug_123');
        expect(data.status).toBe('to-do');
        expect(data.description).toBeUndefined();
      });
    });

    it('should export a tracker item without description', () => {
      const markdown = `Fix the login bug #bug[id:bug_123 status:to-do]`;

      let exported = '';
      editor.update(() => {
        $convertFromEnhancedMarkdownString(markdown, getTestTransformers());
        exported = $convertToMarkdownString(getTestTransformers());
      });

      // Should contain the tracker syntax
      expect(exported).toContain('#bug[');
      expect(exported).toContain('id:bug_123');
      expect(exported).toContain('status:to-do');
    });

    it('should round-trip a tracker item without description', () => {
      const markdown = `Fix the login bug #bug[id:bug_123 status:to-do]`;

      let exported = '';
      editor.update(() => {
        $convertFromEnhancedMarkdownString(markdown, getTestTransformers());
        exported = $convertToMarkdownString(getTestTransformers());
      });

      // Create a new editor and import the exported markdown
      const editor2 = createEditor({
        nodes: [
          HeadingNode,
          QuoteNode,
          ListNode,
          ListItemNode,
          CodeNode,
          LinkNode,
          TrackerItemNode,
        ],
        onError: console.error,
      });

      editor2.update(() => {
        $convertFromEnhancedMarkdownString(exported, getTestTransformers());
      });

      editor2.read(() => {
        const root = $getRoot();
        const children = root.getChildren();

        expect(children.length).toBe(1);
        expect($isTrackerItemNode(children[0])).toBe(true);

        const trackerNode = children[0] as TrackerItemNode;
        const data = trackerNode.getData();

        expect(data.type).toBe('bug');
        expect(data.id).toBe('bug_123');
        expect(data.status).toBe('to-do');
      });
    });
  });

  describe('description handling', () => {
    it('should import a tracker item with single-line description', () => {
      const markdown = `Fix the login bug #bug[id:bug_123 status:to-do]
  This is the description`;

      editor.update(() => {
        $convertFromEnhancedMarkdownString(markdown, getTestTransformers());
      });

      editor.read(() => {
        const root = $getRoot();
        const children = root.getChildren();

        // Should have exactly 1 child (the tracker item with description embedded)
        expect(children.length).toBe(1);
        expect($isTrackerItemNode(children[0])).toBe(true);

        const trackerNode = children[0] as TrackerItemNode;
        const data = trackerNode.getData();

        expect(data.type).toBe('bug');
        expect(data.id).toBe('bug_123');
        expect(data.description).toBe('This is the description');
      });
    });

    it('should import a tracker item with multi-line description', () => {
      const markdown = `Fix the login bug #bug[id:bug_123 status:to-do]
  This is line 1 of the description
  This is line 2 of the description`;

      editor.update(() => {
        $convertFromEnhancedMarkdownString(markdown, getTestTransformers());
      });

      editor.read(() => {
        const root = $getRoot();
        const children = root.getChildren();

        expect(children.length).toBe(1);
        expect($isTrackerItemNode(children[0])).toBe(true);

        const trackerNode = children[0] as TrackerItemNode;
        const data = trackerNode.getData();

        expect(data.description).toBe('This is line 1 of the description\nThis is line 2 of the description');
      });
    });

    it('should stop collecting description at non-indented line', () => {
      const markdown = `Fix the login bug #bug[id:bug_123 status:to-do]
  This is the description
Next paragraph not part of description`;

      editor.update(() => {
        $convertFromEnhancedMarkdownString(markdown, getTestTransformers());
      });

      editor.read(() => {
        const root = $getRoot();
        const children = root.getChildren();

        // Should have 2 children: tracker item and the following paragraph
        expect(children.length).toBe(2);
        expect($isTrackerItemNode(children[0])).toBe(true);

        const trackerNode = children[0] as TrackerItemNode;
        const data = trackerNode.getData();

        expect(data.description).toBe('This is the description');

        // Second child should be a paragraph
        expect(children[1].getTextContent()).toBe('Next paragraph not part of description');
      });
    });

    it('should export a tracker item with description as indented lines', () => {
      const markdown = `Fix the login bug #bug[id:bug_123 status:to-do]
  This is line 1
  This is line 2`;

      let exported = '';
      editor.update(() => {
        $convertFromEnhancedMarkdownString(markdown, getTestTransformers());
        exported = $convertToMarkdownString(getTestTransformers());
      });

      // Should contain indented description lines
      expect(exported).toContain('  This is line 1');
      expect(exported).toContain('  This is line 2');
    });

    it('should round-trip a tracker item with description', () => {
      const markdown = `Fix the login bug #bug[id:bug_123 status:to-do]
  This is the description`;

      let exported = '';
      editor.update(() => {
        $convertFromEnhancedMarkdownString(markdown, getTestTransformers());
        exported = $convertToMarkdownString(getTestTransformers());
      });

      // Create a new editor and import the exported markdown
      const editor2 = createEditor({
        nodes: [
          HeadingNode,
          QuoteNode,
          ListNode,
          ListItemNode,
          CodeNode,
          LinkNode,
          TrackerItemNode,
        ],
        onError: console.error,
      });

      editor2.update(() => {
        $convertFromEnhancedMarkdownString(exported, getTestTransformers());
      });

      editor2.read(() => {
        const root = $getRoot();
        const children = root.getChildren();

        expect(children.length).toBe(1);
        expect($isTrackerItemNode(children[0])).toBe(true);

        const trackerNode = children[0] as TrackerItemNode;
        const data = trackerNode.getData();

        expect(data.type).toBe('bug');
        expect(data.id).toBe('bug_123');
        expect(data.description).toBe('This is the description');
      });
    });
  });

  describe('multiple tracker items', () => {
    it('should handle multiple tracker items with descriptions', () => {
      const markdown = `Fix login #bug[id:bug_1 status:to-do]
  Login description
Add feature #task[id:task_1 status:in-progress]
  Feature description`;

      editor.update(() => {
        $convertFromEnhancedMarkdownString(markdown, getTestTransformers());
      });

      editor.read(() => {
        const root = $getRoot();
        const children = root.getChildren();

        expect(children.length).toBe(2);

        // First tracker item
        expect($isTrackerItemNode(children[0])).toBe(true);
        const bug = children[0] as TrackerItemNode;
        expect(bug.getData().type).toBe('bug');
        expect(bug.getData().description).toBe('Login description');

        // Second tracker item
        expect($isTrackerItemNode(children[1])).toBe(true);
        const task = children[1] as TrackerItemNode;
        expect(task.getData().type).toBe('task');
        expect(task.getData().description).toBe('Feature description');
      });
    });
  });

  describe('edge cases', () => {
    it('should handle tracker item at end of document with description', () => {
      const markdown = `# Header

Fix the bug #bug[id:bug_123 status:to-do]
  Final description`;

      editor.update(() => {
        $convertFromEnhancedMarkdownString(markdown, getTestTransformers());
      });

      editor.read(() => {
        const root = $getRoot();
        const children = root.getChildren();

        // Header + tracker item
        expect(children.length).toBe(2);

        const trackerNode = children[1] as TrackerItemNode;
        expect($isTrackerItemNode(trackerNode)).toBe(true);
        expect(trackerNode.getData().description).toBe('Final description');
      });
    });

    it('should handle empty lines within description', () => {
      const markdown = `Fix the bug #bug[id:bug_123 status:to-do]
  Line 1

  Line 3 after empty`;

      editor.update(() => {
        $convertFromEnhancedMarkdownString(markdown, getTestTransformers());
      });

      editor.read(() => {
        const root = $getRoot();
        const children = root.getChildren();

        expect(children.length).toBe(1);
        expect($isTrackerItemNode(children[0])).toBe(true);

        const trackerNode = children[0] as TrackerItemNode;
        const data = trackerNode.getData();

        // Empty line should be preserved
        expect(data.description).toBe('Line 1\n\nLine 3 after empty');
      });
    });

    it('should handle tracker item with all metadata fields', () => {
      const markdown = `Complex task #task[id:task_xyz status:in-progress priority:high owner:john created:2024-01-01 updated:2024-01-02 tags:frontend,urgent]
  Detailed description here`;

      editor.update(() => {
        $convertFromEnhancedMarkdownString(markdown, getTestTransformers());
      });

      editor.read(() => {
        const root = $getRoot();
        const children = root.getChildren();

        expect(children.length).toBe(1);
        expect($isTrackerItemNode(children[0])).toBe(true);

        const trackerNode = children[0] as TrackerItemNode;
        const data = trackerNode.getData();

        expect(data.type).toBe('task');
        expect(data.id).toBe('task_xyz');
        expect(data.status).toBe('in-progress');
        expect(data.priority).toBe('high');
        expect(data.owner).toBe('john');
        expect(data.created).toBe('2024-01-01');
        expect(data.updated).toBe('2024-01-02');
        expect(data.tags).toEqual(['frontend', 'urgent']);
        expect(data.description).toBe('Detailed description here');
      });
    });
  });
});
