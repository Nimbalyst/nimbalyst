/**
 * Transformer for TrackerItem nodes
 * Exports/imports tracker items in markdown format with metadata in HTML comments
 * Format: @bug <!-- tracker:{...metadata...} -->
 */

import { ElementTransformer, TextMatchTransformer } from '@lexical/markdown';
import { LexicalNode, TextNode } from 'lexical';
import {
  $createTrackerItemNode,
  $isTrackerItemNode,
  TrackerItemData,
  TrackerItemNode,
} from './TrackerItemNode';

// Helper function to generate a ULID-style ID
function generateId(prefix: string): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `${prefix}_${timestamp}${random}`;
}

// TODO GH: Do we really need this extra transformer (See the IMAGE transformer)
// ElementTransformer for EXPORT (handles decorator node serialization)
export const TRACKER_ITEM_ELEMENT_TRANSFORMER: ElementTransformer = {
  dependencies: [TrackerItemNode],
  export: (node: LexicalNode, exportChildren: () => string) => {
    if (!$isTrackerItemNode(node)) {
      return null;
    }

    const data = node.getData();

    // Create the metadata object (omit undefined fields)
    const metadata: Partial<TrackerItemData> = {
      id: data.id,
      type: data.type,
      status: data.status,
    };

    if (data.priority) metadata.priority = data.priority;
    if (data.owner) metadata.owner = data.owner;
    if (data.tags && data.tags.length > 0) metadata.tags = data.tags;
    if (data.created) metadata.created = data.created;
    if (data.updated) metadata.updated = data.updated;
    if (data.dueDate) metadata.dueDate = data.dueDate;
    if (data.title) metadata.title = data.title;

    // Export as @type[key:value ...] format for readability
    const parts: string[] = [];
    parts.push(`id:${metadata.id}`);
    parts.push(`status:${metadata.status}`);
    if (metadata.priority) parts.push(`priority:${metadata.priority}`);
    if (metadata.owner) parts.push(`owner:${metadata.owner}`);
    if (metadata.created) parts.push(`created:${metadata.created}`);
    if (metadata.updated) parts.push(`updated:${metadata.updated}`);
    if (metadata.dueDate) parts.push(`due:${metadata.dueDate}`);
    if (metadata.title) parts.push(`title:"${metadata.title.replace(/"/g, '\\"')}"`);
    if (metadata.tags && metadata.tags.length > 0) parts.push(`tags:${metadata.tags.join(',')}`);

    return `@${data.type}[${parts.join(' ')}]`;
  },
  regExp: /(?!)/,  // Never match - negative lookahead that always fails
  replace: () => {},
  type: 'element',
};

// TextMatchTransformer for IMPORT (handles typing @bug and converting to node)
export const TRACKER_ITEM_TEXT_TRANSFORMER: TextMatchTransformer = {
  dependencies: [TrackerItemNode],
  export: () => null,  // Export handled by ElementTransformer
  importRegExp: /@(bug|task|plan)\[.+?\]/,
  regExp: /@(bug|task|plan)\[.+?\]/,
  replace: (textNode: TextNode, match: RegExpMatchArray) => {
    console.log('TrackerItem transformer matched:', match[0]);
    const fullMatch = match[0];
    const typeMatch = fullMatch.match(/@(bug|task|plan)\[(.+?)\]/);
    if (!typeMatch) {
      console.log('No type match found');
      return null;
    }

    const [, type, propsStr] = typeMatch;
    console.log('Type:', type, 'Props:', propsStr);

    try {
      // Parse key:value pairs
      const metadata: Partial<TrackerItemData> = { type: type as TrackerItemData['type'] };

      // Match key:value or key:"value with spaces"
      const propRegex = /(\w+):((?:"[^"]*")|(?:[^\s]+))/g;
      let propMatch;
      while ((propMatch = propRegex.exec(propsStr)) !== null) {
        const [, key, value] = propMatch;
        const cleanValue = value.startsWith('"') ? value.slice(1, -1).replace(/\\"/g, '"') : value;

        switch (key) {
          case 'id': metadata.id = cleanValue; break;
          case 'status': metadata.status = cleanValue as TrackerItemData['status']; break;
          case 'priority': metadata.priority = cleanValue as TrackerItemData['priority']; break;
          case 'owner': metadata.owner = cleanValue; break;
          case 'created': metadata.created = cleanValue; break;
          case 'updated': metadata.updated = cleanValue; break;
          case 'due': metadata.dueDate = cleanValue; break;
          case 'title': metadata.title = cleanValue; break;
          case 'tags': metadata.tags = cleanValue.split(','); break;
        }
      }

      // Generate ID if not present
      const id = metadata.id || generateId(type || 'tsk');

      const data: TrackerItemData = {
        id,
        type: (type || metadata.type || 'task') as TrackerItemData['type'],
        title: metadata.title || `New ${type}`,
        status: metadata.status || 'to-do',
        priority: metadata.priority,
        owner: metadata.owner,
        tags: metadata.tags,
        created: metadata.created || new Date().toISOString().split('T')[0],
        updated: metadata.updated,
        dueDate: metadata.dueDate,
      };

      console.log('Creating TrackerItemNode with data:', data);
      const node = $createTrackerItemNode(data);
      console.log('Created node:', node);
      // return node;
      textNode.replace(node);
    } catch (e) {
      // If parsing fails, return null to leave as text
      console.error('Failed to parse tracker item metadata:', e);
      return null;
    }
  },
  trigger: '@',
  type: 'text-match',
};

// Export both transformers as an array for convenience
export const TRACKER_ITEM_TRANSFORMERS = [
  TRACKER_ITEM_ELEMENT_TRANSFORMER,
  TRACKER_ITEM_TEXT_TRANSFORMER,
];
