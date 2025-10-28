import {
  $getRoot,
  $isElementNode,
  type LexicalEditor,
  type LexicalNode,
} from 'lexical';
import { $isListNode, $isListItemNode } from '@lexical/list';
import { $getDiffState } from './DiffState';

export interface DiffChangeGroup {
  id: string;
  startNode: LexicalNode;
  endNode: LexicalNode;
  nodes: LexicalNode[];
  types: Set<'added' | 'removed' | 'modified'>;
}

/**
 * Groups diff changes intelligently:
 * - Consecutive removed+added nodes are grouped together (replacements)
 * - Isolated added/removed nodes are separate groups
 * - Modified nodes are individual groups
 *
 * This matches user intent where a replacement (remove old + add new) is one change.
 */
export function groupDiffChanges(editor: LexicalEditor): DiffChangeGroup[] {
  const groups: DiffChangeGroup[] = [];
  let groupId = 0;

  editor.getEditorState().read(() => {
    const root = $getRoot();

    // Collect all nodes that have diff state in document order
    const allDiffNodes: Array<{ node: LexicalNode; state: 'added' | 'removed' | 'modified' }> = [];

    const collectDiffNodes = (node: LexicalNode) => {
      const diffState = $getDiffState(node);
      const nodeType = node.getType();
      const isLegacyDiff = nodeType === 'add' || nodeType === 'remove';

      // Check if this node has diff state
      const hasDiffState = diffState || isLegacyDiff;

      // Check if any children have diff state
      let childHasDiffState = false;
      if ($isElementNode(node)) {
        const children = node.getChildren();
        for (const child of children) {
          const childDiffState = $getDiffState(child);
          const childNodeType = child.getType();
          if (childDiffState || childNodeType === 'add' || childNodeType === 'remove') {
            childHasDiffState = true;
            break;
          }
        }
      }

      // Only collect this node if it has diff state AND no children have diff state
      // This prevents collecting parent containers when their children are the actual changes
      // IMPORTANT: Exclude 'modified' nodes - they are just metadata markers on parent containers
      if (hasDiffState && !childHasDiffState) {
        if (diffState && diffState !== 'modified') {
          allDiffNodes.push({ node, state: diffState });
        } else if (isLegacyDiff) {
          // Legacy support
          allDiffNodes.push({
            node,
            state: nodeType === 'add' ? 'added' : 'removed'
          });
        }
      }

      // Recurse into children regardless
      if ($isElementNode(node)) {
        const children = node.getChildren();
        for (const child of children) {
          collectDiffNodes(child);
        }
      }
    };

    const children = root.getChildren();
    for (const child of children) {
      collectDiffNodes(child);
    }

    // Now group them intelligently
    let i = 0;
    while (i < allDiffNodes.length) {
      const current = allDiffNodes[i];
      const nodes: LexicalNode[] = [current.node];
      const types: Set<'added' | 'removed' | 'modified'> = new Set([current.state]);

      // Check if this is part of a remove+add pair
      if (current.state === 'removed' && i + 1 < allDiffNodes.length) {
        const next = allDiffNodes[i + 1];

        // If next is 'added', group them together as a replacement
        if (next.state === 'added') {
          nodes.push(next.node);
          types.add(next.state);
          i += 2; // Skip both nodes
        } else {
          i += 1; // Just this node
        }
      } else {
        i += 1; // Just this node
      }

      // Create the group
      groups.push({
        id: `group-${groupId++}`,
        startNode: nodes[0],
        endNode: nodes[nodes.length - 1],
        nodes,
        types,
      });
    }
  });

  return groups;
}

export function scrollToChangeGroup(
  editor: LexicalEditor,
  groupIndex: number,
  groups: DiffChangeGroup[],
): void {
  if (groupIndex < 0 || groupIndex >= groups.length) {
    return;
  }

  const group = groups[groupIndex];
  const startNode = group.startNode;

  editor.update(() => {
    try {
      const element = editor.getElementByKey(startNode.getKey());
      if (element) {
        element.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
        });
      }
    } catch (error) {
      console.warn('Failed to scroll to change group:', error);
    }
  });
}
