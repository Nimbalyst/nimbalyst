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
import {$isTableNode, $isTableRowNode, $isTableCellNode} from '@lexical/table';
import {createNodeFromSerialized} from '../core/createNodeFromSerialized';
import {$setDiffState, $setOriginalMarkdown, $getOriginalMarkdown, $clearOriginalMarkdown, $getDiffState, $clearDiffState} from '../core/DiffState';
import {$convertFromMarkdownString} from '@lexical/markdown';
import {$applySubTreeDiff} from '../core/diffUtils';
import {$convertNodeToMarkdownString} from '../../../markdown/nodeMarkdownExport';
import {MARKDOWN_TRANSFORMERS} from '../../../markdown';

export class TableDiffHandler implements DiffNodeHandler {
  readonly nodeType = 'table';

  canHandle(context: DiffHandlerContext): boolean {
    // Handle table nodes
    return context.liveNode.getType() === 'table' || 
           context.targetNode?.type === 'table' ||
           context.sourceNode?.type === 'table';
  }

  handleUpdate(context: DiffHandlerContext): DiffHandlerResult {
    const {liveNode, targetNode, sourceNode, sourceEditor, targetEditor, transformers} = context;
    
    console.log('TableDiffHandler: Handling table update with sub-tree diff');
    
    if (!$isTableNode(liveNode)) {
      console.warn('TableDiffHandler: liveNode is not a table');
      return {handled: false};
    }

    if (targetNode.type !== 'table') {
      console.warn('TableDiffHandler: targetNode is not a table');
      return {handled: false};
    }

    if (!sourceNode || sourceNode.type !== 'table') {
      console.warn('TableDiffHandler: sourceNode is not a table');
      return {handled: false};
    }

    try {
      // Check if table structure (rows/cols) changed
      const sourceRows = ('children' in sourceNode && sourceNode.children) || [];
      const targetRows = ('children' in targetNode && targetNode.children) || [];
      
      const sourceRowCount = sourceRows.length;
      const targetRowCount = targetRows.length;
      const sourceColCount = this.getMaxColCount(sourceRows);
      const targetColCount = this.getMaxColCount(targetRows);
      
      // If structure changed significantly, replace the whole table
      if (sourceRowCount !== targetRowCount || sourceColCount !== targetColCount) {
        console.log('Table structure changed - replacing entire table');
        $setDiffState(liveNode, 'removed');
        const newTable = createNodeFromSerialized(targetNode);
        if (!$isElementNode(newTable)) {
          return {handled: false};
        }
        $setDiffState(newTable, 'added');
        liveNode.insertAfter(newTable);
        return {handled: true, skipChildren: true};
      }
      
      // Table structure is the same, apply cell-level diffs
      console.log('Table structure unchanged - applying cell-level diffs');
      
      // Mark table as modified if any cell changed
      const hasChanges = this.hasTableChanges(sourceNode, targetNode);
      if (hasChanges) {
        $setDiffState(liveNode, 'modified');
      }
      
      // Apply sub-tree diff for cell-level changes
      if (sourceEditor && targetEditor) {
        // Process each row
        const liveRows = liveNode.getChildren();
        for (let rowIdx = 0; rowIdx < liveRows.length; rowIdx++) {
          const liveRow = liveRows[rowIdx];
          if (!$isTableRowNode(liveRow)) continue;
          
          const sourceRow = sourceRows[rowIdx];
          const targetRow = targetRows[rowIdx];
          
          if (!sourceRow || !targetRow) continue;
          
          // Process each cell in the row
          const liveCells = liveRow.getChildren();
          const sourceCells = ('children' in sourceRow && sourceRow.children) || [];
          const targetCells = ('children' in targetRow && targetRow.children) || [];
          
          for (let cellIdx = 0; cellIdx < liveCells.length; cellIdx++) {
            const liveCell = liveCells[cellIdx];
            if (!$isTableCellNode(liveCell)) continue;
            
            const sourceCell = sourceCells[cellIdx];
            const targetCell = targetCells[cellIdx];
            
            if (!sourceCell || !targetCell) continue;
            
            // Get the actual cell nodes from the editors to compare markdown
            let sourceCellMarkdown = '';
            let targetCellMarkdown = '';
            
            // Get the live cell markdown (current state)
            const liveCellMarkdown = $convertNodeToMarkdownString(transformers, liveCell);
            
            // We need to create temporary nodes to get markdown from serialized data
            // Create nodes from serialized data and export their markdown
            const tempSourceCell = createNodeFromSerialized(sourceCell);
            const tempTargetCell = createNodeFromSerialized(targetCell);
            
            if ($isTableCellNode(tempSourceCell)) {
              sourceCellMarkdown = $convertNodeToMarkdownString(transformers, tempSourceCell);
            }
            
            if ($isTableCellNode(tempTargetCell)) {
              targetCellMarkdown = $convertNodeToMarkdownString(transformers, tempTargetCell);
            }
            
            console.log(`Cell [${rowIdx}][${cellIdx}] comparison:`);
            console.log(`  Live: "${liveCellMarkdown}"`);
            console.log(`  Source: "${sourceCellMarkdown}"`);
            console.log(`  Target: "${targetCellMarkdown}"`);
            
            // Compare the markdown content
            if (sourceCellMarkdown !== targetCellMarkdown) {
              console.log(`  -> Cell content changed, replacing cell content...`);
              
              // Store the original markdown on the EXISTING cell so we can restore it on reject
              $setOriginalMarkdown(liveCell, sourceCellMarkdown);
              $setDiffState(liveCell, 'modified');
              
              // Clear the cell content before applying new content
              liveCell.getChildren().forEach(child => child.remove());
              
              // Apply the new content from the target
              if (targetCellMarkdown.trim()) {
                $convertFromMarkdownString(targetCellMarkdown, transformers, liveCell);
              }
            }
          }
        }
      }
      
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

  handleReject(liveNode: LexicalNode, validator?: any): DiffHandlerResult {
    if (!$isTableNode(liveNode)) {
      return {handled: false};
    }

    // Process each cell to restore original content if modified
    const rows = liveNode.getChildren();
    for (const row of rows) {
      if (!$isTableRowNode(row)) continue;
      
      const cells = row.getChildren();
      for (const cell of cells) {
        if (!$isTableCellNode(cell)) continue;
        
        // Check if this cell was modified and has original markdown stored
        const diffState = $getDiffState(cell);
        const originalMarkdown = $getOriginalMarkdown(cell);
        
        if (diffState === 'modified' && originalMarkdown !== null) {
          console.log(`Restoring cell to original markdown: "${originalMarkdown}"`);
          
          // Clear the cell content
          cell.getChildren().forEach(child => child.remove());
          
          // Restore from original markdown
          if (originalMarkdown.trim()) {
            // Parse the markdown back into the cell
            // Use the same transformers that were used originally
            $convertFromMarkdownString(originalMarkdown, MARKDOWN_TRANSFORMERS, cell);
          }
          
          // Clear the diff state and original markdown
          $clearDiffState(cell);
          $clearOriginalMarkdown(cell);
        }
      }
    }
    
    return {handled: true, skipChildren: true};
  }

  /**
   * Get maximum column count across all rows
   */
  private getMaxColCount(rows: any[]): number {
    let maxCols = 0;
    for (const row of rows) {
      if ('children' in row && Array.isArray(row.children)) {
        maxCols = Math.max(maxCols, row.children.length);
      }
    }
    return maxCols;
  }
  
  /**
   * Check if table has any changes
   */
  private hasTableChanges(sourceNode: SerializedLexicalNode, targetNode: SerializedLexicalNode): boolean {
    const sourceCells = this.extractTableCells(sourceNode);
    const targetCells = this.extractTableCells(targetNode);
    
    // Check if any cells changed
    for (const [key, sourceText] of sourceCells) {
      const targetText = targetCells.get(key);
      if (targetText !== sourceText) {
        return true;
      }
    }
    
    // Check for added cells
    for (const key of targetCells.keys()) {
      if (!sourceCells.has(key)) {
        return true;
      }
    }
    
    return false;
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
   * Extract plain text content from a table cell for basic comparison
   */
  private extractCellText(cell: any): string {
    if (!cell || !('children' in cell)) {
      return '';
    }
    
    // Simple text extraction for backward compatibility
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
  
}