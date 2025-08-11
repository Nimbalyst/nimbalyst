/**
 * Handler for table node diffs.
 * Tables are complex structures that need to be replaced entirely when changed.
 */

import type {
  DiffHandlerContext,
  DiffHandlerResult,
  DiffNodeHandler,
} from './DiffNodeHandler';
import type {ElementNode, LexicalNode, SerializedLexicalNode} from 'lexical';
import {$isElementNode} from 'lexical';
import {$isTableNode} from '@lexical/table';
import {createNodeFromSerialized} from '../core/createNodeFromSerialized';
import {$setDiffState} from '../core/DiffState';

export class TableDiffHandler implements DiffNodeHandler {
  readonly nodeType = 'table';

  canHandle(context: DiffHandlerContext): boolean {
    // Handle table nodes
    return context.liveNode.getType() === 'table' || 
           context.targetNode?.type === 'table' ||
           context.sourceNode?.type === 'table';
  }

  handleUpdate(context: DiffHandlerContext): DiffHandlerResult {
    const {liveNode, targetNode} = context;
    
    console.log('TableDiffHandler: Handling table update');
    
    if (!$isTableNode(liveNode)) {
      console.warn('TableDiffHandler: liveNode is not a table');
      return {handled: false};
    }

    if (targetNode.type !== 'table') {
      console.warn('TableDiffHandler: targetNode is not a table');
      return {handled: false};
    }

    try {
      // For tables, we need to replace the entire structure
      // Create a new table from the target serialized node
      const newTable = createNodeFromSerialized(targetNode);
      
      if (!$isElementNode(newTable)) {
        console.error('TableDiffHandler: Failed to create new table node');
        return {handled: false};
      }
      
      // Mark the new table as modified (not the individual cells yet)
      $setDiffState(newTable, 'modified');
      
      // Now we need to compare the old and new table structures to mark what changed
      // Get the serialized versions to compare
      const sourceTableData = context.sourceNode;
      
      // Extract cell content from both tables for comparison
      const sourceCells = this.extractTableCells(sourceTableData);
      const targetCells = this.extractTableCells(targetNode);
      
      // Mark cells in the new table based on what changed
      this.markTableCellDiffs(newTable, sourceCells, targetCells);
      
      // Replace the old table with the new one
      liveNode.replace(newTable);
      
      console.log('TableDiffHandler: Successfully replaced table with diff states');
      return {handled: true, skipChildren: true};
    } catch (error) {
      console.error('TableDiffHandler: Error updating table:', error);
      return {
        handled: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  handleAdd(
    targetNode: SerializedLexicalNode,
    parentNode: ElementNode,
    position: number,
  ): DiffHandlerResult {
    if (targetNode.type !== 'table') {
      return {handled: false};
    }

    try {
      const newTable = createNodeFromSerialized(targetNode);
      if (!$isElementNode(newTable)) {
        return {handled: false};
      }

      $setDiffState(newTable, 'added');

      const children = parentNode.getChildren();
      if (position < children.length) {
        children[position].insertBefore(newTable);
      } else {
        parentNode.append(newTable);
      }

      return {handled: true};
    } catch (error) {
      return {
        handled: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  handleRemove(liveNode: LexicalNode): DiffHandlerResult {
    if (!$isTableNode(liveNode)) {
      return {handled: false};
    }

    try {
      $setDiffState(liveNode, 'removed');
      return {handled: true};
    } catch (error) {
      return {
        handled: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  handleApprove(liveNode: LexicalNode): DiffHandlerResult {
    // Approval is handled externally via DiffState
    return {handled: true, skipChildren: true};
  }

  handleReject(liveNode: LexicalNode): DiffHandlerResult {
    // Rejection is handled externally via DiffState
    return {handled: true, skipChildren: true};
  }

  /**
   * Extract cell content from a serialized table for comparison
   */
  private extractTableCells(tableNode: SerializedLexicalNode): Map<string, string> {
    const cells = new Map<string, string>();
    
    if (!tableNode || tableNode.type !== 'table' || !('children' in tableNode)) {
      return cells;
    }
    
    // Navigate through table structure: table -> tbody/thead -> tr -> td/th
    const rows = tableNode.children || [];
    
    rows.forEach((row: any, rowIndex: number) => {
      if (row && 'children' in row) {
        const rowCells = row.children || [];
        rowCells.forEach((cell: any, colIndex: number) => {
          if (cell && cell.type === 'tablecell') {
            // Extract text content from the cell
            const cellContent = this.extractCellText(cell);
            const cellKey = `${rowIndex}-${colIndex}`;
            cells.set(cellKey, cellContent);
          }
        });
      }
    });
    
    return cells;
  }
  
  /**
   * Extract text content from a table cell
   */
  private extractCellText(cell: any): string {
    if (!cell || !('children' in cell)) {
      return '';
    }
    
    let text = '';
    cell.children.forEach((child: any) => {
      if (child.type === 'paragraph' && 'children' in child) {
        child.children.forEach((textNode: any) => {
          if (textNode.type === 'text' && 'text' in textNode) {
            text += textNode.text;
          }
        });
      }
    });
    
    return text;
  }
  
  /**
   * Mark cells in the new table with appropriate diff states
   */
  private markTableCellDiffs(
    newTable: LexicalNode,
    sourceCells: Map<string, string>,
    targetCells: Map<string, string>
  ): void {
    if (!$isTableNode(newTable)) {
      return;
    }
    
    // Get all table cells from the new table
    const rows = newTable.getChildren();
    
    rows.forEach((row, rowIndex) => {
      if ('getChildren' in row) {
        const cells = (row as any).getChildren();
        cells.forEach((cell: any, colIndex: number) => {
          const cellKey = `${rowIndex}-${colIndex}`;
          const sourceContent = sourceCells.get(cellKey);
          const targetContent = targetCells.get(cellKey);
          
          if (sourceContent === undefined && targetContent !== undefined) {
            // This is a new cell (added column)
            $setDiffState(cell, 'added');
          } else if (sourceContent !== targetContent) {
            // This cell's content changed
            $setDiffState(cell, 'modified');
          }
          // If sourceContent === targetContent, leave unmarked (no change)
        });
      }
    });
  }
}