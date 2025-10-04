/**
 * PlanTableComponent - Lexical decorator wrapper for PlanTable
 * This component provides Lexical context integration for the standalone PlanTable
 */

import React from 'react';
import { NodeKey, $getNodeByKey } from 'lexical';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { useLexicalNodeSelection } from '@lexical/react/useLexicalNodeSelection';
import { PlanTable } from './PlanTable';
import type { SortColumn, SortDirection } from './PlanTable';
import { PlanTableNode } from './PlanTableNode';
import './PlanTable.css';

interface PlanTableComponentProps {
  nodeKey: NodeKey;
  sortBy?: SortColumn;
  sortDirection?: SortDirection;
}

export default function PlanTableComponent({
  nodeKey,
  sortBy = 'lastUpdated',
  sortDirection = 'desc'
}: PlanTableComponentProps): JSX.Element {
  const [editor] = useLexicalComposerContext();
  const [isSelected] = useLexicalNodeSelection(nodeKey);

  const handleSortChange = (column: SortColumn, direction: SortDirection) => {
    editor.update(() => {
      const node = $getNodeByKey(nodeKey) as PlanTableNode | null;
      if (node) {
        node.setSorting(column, direction);
      }
    });
  };

  // Delegate to standalone PlanTable component
  return (
    <PlanTable
      sortBy={sortBy}
      sortDirection={sortDirection}
      onSortChange={handleSortChange}
      isSelected={isSelected}
    />
  );
}
