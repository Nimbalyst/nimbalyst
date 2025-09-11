import { LexicalEditor, LexicalNode, $getNodeByKey } from 'lexical';
import { $createTableNode, $createTableRowNode, $createTableCellNode, TableNode } from '@lexical/table';
import { $createParagraphNode, $createTextNode, $createHeadingNode } from 'lexical';
import { BoardNode, $isBoardNode, $createBoardNode } from './BoardNode';
import { $isColumnNode } from './BoardColumnNode';
import { $isColumnHeaderNode } from './BoardColumnHeaderNode';
import { $isColumnContentNode } from './BoardColumnContentNode';
import { $isCardNode } from './BoardCardNode';
import { draggableBlockMenuRegistry } from '../DraggableBlockPlugin/DraggableBlockMenuRegistry';

/**
 * Transform a BoardNode into a TableNode
 * Each card becomes a row in the table
 * Fields (Title, Status, Owner, Due Date, Priority, Description) become columns
 */
export function $transformBoardToTable(boardNode: BoardNode): TableNode | null {
  if (!$isBoardNode(boardNode)) {
    return null;
  }

  const tableNode = $createTableNode();
  const columns = boardNode.getChildren().filter($isColumnNode);
  
  if (columns.length === 0) {
    return null;
  }

  // Collect all cards from all columns
  const allCards: Array<{card: any, status: string}> = [];
  
  columns.forEach(column => {
    const header = column.getChildren().find($isColumnHeaderNode);
    const statusName = header ? header.getTextContent() : 'Unknown';
    const content = column.getChildren().find($isColumnContentNode);
    const cards = content ? content.getChildren().filter($isCardNode) : [];
    
    cards.forEach(card => {
      allCards.push({ card, status: statusName });
    });
  });

  // Create header row with field names
  const headerRow = $createTableRowNode();
  const headers = ['Title', 'Status', 'Owner', 'Due Date', 'Priority', 'Description'];
  
  headers.forEach(headerText => {
    const headerCell = $createTableCellNode(true); // isHeader = true
    const paragraph = $createParagraphNode();
    paragraph.append($createTextNode(headerText));
    headerCell.append(paragraph);
    headerRow.append(headerCell);
  });
  tableNode.append(headerRow);

  // Create a row for each card
  allCards.forEach(({ card, status }) => {
    const row = $createTableRowNode();
    const cardData = card.getData();
    const cardText = card.getTextContent();
    
    // Title cell
    const titleCell = $createTableCellNode(false);
    const titleParagraph = $createParagraphNode();
    titleParagraph.append($createTextNode(cardData.title || cardText || ''));
    titleCell.append(titleParagraph);
    row.append(titleCell);
    
    // Status cell
    const statusCell = $createTableCellNode(false);
    const statusParagraph = $createParagraphNode();
    statusParagraph.append($createTextNode(status));
    statusCell.append(statusParagraph);
    row.append(statusCell);
    
    // Owner cell
    const ownerCell = $createTableCellNode(false);
    const ownerParagraph = $createParagraphNode();
    ownerParagraph.append($createTextNode(cardData.owner || ''));
    ownerCell.append(ownerParagraph);
    row.append(ownerCell);
    
    // Due Date cell
    const dueDateCell = $createTableCellNode(false);
    const dueDateParagraph = $createParagraphNode();
    dueDateParagraph.append($createTextNode(cardData.dueDate || ''));
    dueDateCell.append(dueDateParagraph);
    row.append(dueDateCell);
    
    // Priority cell
    const priorityCell = $createTableCellNode(false);
    const priorityParagraph = $createParagraphNode();
    priorityParagraph.append($createTextNode(cardData.priority || ''));
    priorityCell.append(priorityParagraph);
    row.append(priorityCell);
    
    // Description cell
    const descCell = $createTableCellNode(false);
    const descParagraph = $createParagraphNode();
    descParagraph.append($createTextNode(cardData.description || ''));
    descCell.append(descParagraph);
    row.append(descCell);
    
    tableNode.append(row);
  });

  return tableNode;
}

/**
 * Transform a TableNode into a BoardNode
 * First row becomes column headers
 * Each column becomes a board column
 * Each cell in subsequent rows becomes a card
 */
export function $transformTableToBoard(tableNode: TableNode): BoardNode | null {
  // This would need proper implementation with TableNode API
  // For now, return null as a placeholder
  return null;
}

/**
 * Register the transform commands with the DraggableBlockPlugin
 */
export function registerBoardTransformCommands(): () => void {
  // Register Board to Table transform
  const unregisterBoardToTable = draggableBlockMenuRegistry.registerMenuItem({
    id: 'transform-board-to-table',
    label: 'Convert to Table',
    icon: 'table_chart',
    nodeTypes: ['kanban-board'],
    order: 100,
    command: (editor: LexicalEditor, node: LexicalNode) => {
      editor.update(() => {
        if ($isBoardNode(node)) {
          const tableNode = $transformBoardToTable(node);
          if (tableNode) {
            node.replace(tableNode);
          }
        }
      });
    }
  });

  // Register Table to Board transform (when we have table support)
  // const unregisterTableToBoard = draggableBlockMenuRegistry.registerMenuItem({
  //   id: 'transform-table-to-board',
  //   label: 'Convert to Kanban Board',
  //   icon: 'view_kanban',
  //   nodeTypes: ['table'],
  //   order: 100,
  //   command: (editor: LexicalEditor, node: LexicalNode) => {
  //     editor.update(() => {
  //       // Implementation needed
  //     });
  //   }
  // });

  return () => {
    unregisterBoardToTable();
    // unregisterTableToBoard();
  };
}