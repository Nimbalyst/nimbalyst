import {useLexicalComposerContext} from '@lexical/react/LexicalComposerContext';
import {useEffect, useRef, useContext, useState} from 'react';
import {
    DRAGOVER_COMMAND,
    DROP_COMMAND,
    COMMAND_PRIORITY_HIGH,
    COMMAND_PRIORITY_LOW,
    $getNearestNodeFromDOMNode,
    $createParagraphNode,
    $createTextNode,
    $getRoot, $isElementNode, $getNodeByKey,
} from 'lexical';
import {mergeRegister} from '@lexical/utils';

import {
    registerKanbanCommands,
    MOVE_BOARD_CARD_COMMAND,
} from './BoardCommands';
import {
    BoardNode,
    $isBoardNode,
} from './BoardNode';
import {
    BoardColumnNode,
    $isColumnNode,
} from './BoardColumnNode';
import {
    BoardColumnHeaderNode,
} from './BoardColumnHeaderNode';
import {
    BoardColumnContentNode,
    $isColumnContentNode,
} from './BoardColumnContentNode';
import {
    BoardCardNode,
    $isCardNode,
    $createCardNode,
} from './BoardCardNode';
// import {BoardSyncService} from './BoardSyncService';
// import {useGraphCollaboration} from '../../space/graph/GraphCollaborationProvider';
// Stub out missing dependencies for now
const useGraphCollaboration = () => null;
class BoardSyncService {
    constructor(...args: any[]) {}
    start() {}
    stop() {}
    updateConfig(config: any) {}
}
import {BoardConfigDialog, BoardConfig} from './BoardConfigDialog';
import {createPortal} from 'react-dom';

export function BoardPlugin(): JSX.Element | null {
    const [editor] = useLexicalComposerContext();
    const graphCollaboration = useGraphCollaboration();
    const syncServicesRef = useRef<Map<string, BoardSyncService>>(new Map());
    const [showConfigDialog, setShowConfigDialog] = useState(false);
    const [currentConfigNodeKey, setCurrentConfigNodeKey] = useState<string | null>(null);
    const [currentConfig, setCurrentConfig] = useState<BoardConfig | null>(null);

    useEffect(() => {
        console.log("BoardPlugin mounted");
        if (!editor.hasNodes([BoardNode, BoardColumnNode, BoardColumnHeaderNode, BoardColumnContentNode, BoardCardNode])) {
            throw new Error(
                'BoardPlugin: Required nodes not registered on editor',
            );
        }

        const unregisterCommands = registerKanbanCommands(editor);

        // Initialize sync services for existing board nodes
        const initializeBoardSyncServices = () => {
            editor.getEditorState().read(() => {
                const root = $getRoot();

                const visitNodes = (node: any) => {
                    if ($isBoardNode(node)) {
                        const config = node.getConfig();
                        if (config && graphCollaboration) {
                            const syncService = new BoardSyncService(
                                editor,
                                graphCollaboration,
                                config,
                                node.getKey()
                            );
                            syncService.start();
                            syncServicesRef.current.set(node.getKey(), syncService);
                        }
                    }

                    if ($isElementNode(node)) {
                        const children = node.getChildren();
                        for (const child of children) {
                            visitNodes(child);
                        }
                    }
                };

                visitNodes(root);
            });
        };

        // Initialize sync services after a short delay to ensure graph collaboration is ready
        const timeout = setTimeout(initializeBoardSyncServices, 100);

        // Listen for new board nodes being created
        const handleBoardCreated = (event: CustomEvent) => {
            const {nodeKey, config} = event.detail;
            if (config && graphCollaboration) {
                const syncService = new BoardSyncService(
                    editor,
                    graphCollaboration,
                    config,
                    nodeKey
                );
                syncService.start();
                syncServicesRef.current.set(nodeKey, syncService);
            }
        };

        window.addEventListener('board-created', handleBoardCreated as EventListener);

        // Handle board configuration events
        const handleBoardConfigure = (event: CustomEvent) => {
            const { boardNodeKey, currentConfig } = event.detail;
            setCurrentConfigNodeKey(boardNodeKey);
            setCurrentConfig(currentConfig);
            setShowConfigDialog(true);
        };

        window.addEventListener('board-configure', handleBoardConfigure as EventListener);

        // Handle column menu events
        const handleColumnMenu = (event: CustomEvent) => {
            const {columnElement, buttonElement} = event.detail;
            console.log('Column menu clicked:', {columnElement, buttonElement});

            // TODO: Implement column menu functionality
            // This could open a context menu with options like:
            // - Add card
            // - Delete column
            // - Rename column
            // - Add enum selector
            // - Configure column
        };

        window.addEventListener('kanban-column-menu', handleColumnMenu as EventListener);

        // Register drag and drop commands following Lexical's pattern
        const unregisterDragDrop = mergeRegister(
            editor.registerCommand(
                DRAGOVER_COMMAND,
                (event: DragEvent) => {
                    const target = event.target as HTMLElement;
                    const columnContent = target.closest('.kanban-column-content');

                    if (columnContent && event.dataTransfer?.types.includes('application/x-kanban-card')) {
                        event.preventDefault();
                        // Add visual feedback
                        columnContent.style.backgroundColor = '#f0f8ff';
                        columnContent.style.borderColor = '#4a90e2';
                        columnContent.style.borderStyle = 'dashed';
                        return true;
                    }

                    return false;
                },
                COMMAND_PRIORITY_LOW,
            ),

            editor.registerCommand(
                DROP_COMMAND,
                (event: DragEvent) => {
                    const target = event.target as HTMLElement;
                    const columnContent = target.closest('.kanban-column-content');
                    const column = target.closest('.kanban-column');

                    if (!columnContent || !column || !event.dataTransfer?.types.includes('application/x-kanban-card')) {
                        return false;
                    }

                    // Reset visual feedback
                    columnContent.style.backgroundColor = 'white';
                    columnContent.style.borderColor = '#ddd';
                    columnContent.style.borderStyle = 'solid';

                    const cardId = event.dataTransfer.getData('application/x-kanban-card');
                    if (!cardId) {
                        return false;
                    }

                    // Find the target column content node
                    const targetColumnContentNode = $getNearestNodeFromDOMNode(columnContent);
                    if (!$isColumnContentNode(targetColumnContentNode)) {
                        return false;
                    }

                    // Find source card
                    const cardElement = document.querySelector(`[data-card-id="${cardId}"]`);
                    if (!cardElement) {
                        return false;
                    }

                    const sourceCardNode = $getNearestNodeFromDOMNode(cardElement);
                    if (!$isCardNode(sourceCardNode)) {
                        return false;
                    }

                    // Get the source column to check if it's different
                    const sourceColumn = cardElement.closest('.kanban-column');
                    if (sourceColumn === column) {
                        return true; // Same column, no-op
                    }

                    // Dispatch the move command with proper node references
                    editor.update(() => {
                        const cardText = sourceCardNode.getTextContent() || 'Moved card';

                        // Remove the original card
                        sourceCardNode.remove();

                        // Create a new card with the same content using proper Lexical functions
                        const newCard = $createCardNode(cardId);
                        const paragraph = $createParagraphNode();
                        paragraph.append($createTextNode(cardText));
                        newCard.append(paragraph);

                        // Append the new card to the target column content
                        targetColumnContentNode.append(newCard);
                    });

                    // Notify sync service about the move
                    const boardElement = target.closest('.kanban-board');
                    if (boardElement) {
                        const boardNode = $getNearestNodeFromDOMNode(boardElement);
                        if ($isBoardNode(boardNode)) {
                            const syncService = syncServicesRef.current.get(boardNode.getKey());
                            if (syncService) {
                                // Calculate column indices
                                const columns = Array.from(boardElement.querySelectorAll('.kanban-column'));
                                const fromColumnIndex = columns.findIndex(col => col.contains(sourceColumn));
                                const toColumnIndex = columns.findIndex(col => col === column);

                                // Dispatch custom event for sync service
                                window.dispatchEvent(new CustomEvent('kanban-card-moved', {
                                    detail: {cardId, fromColumnIndex, toColumnIndex}
                                }));
                            }
                        }
                    }

                    return true;
                },
                COMMAND_PRIORITY_HIGH,
            ),
        );

        return () => {
            clearTimeout(timeout);
            unregisterCommands();
            unregisterDragDrop();
            window.removeEventListener('kanban-column-menu', handleColumnMenu as EventListener);
            window.removeEventListener('board-created', handleBoardCreated as EventListener);
            window.removeEventListener('board-configure', handleBoardConfigure as EventListener);

            // Clean up sync services
            syncServicesRef.current.forEach(syncService => {
                syncService.stop();
            });
            syncServicesRef.current.clear();
        };
    }, [editor, graphCollaboration]);

    const handleBoardConfigured = (config: BoardConfig) => {
        if (!currentConfigNodeKey) return;

        editor.update(() => {
            const boardNode = $getNodeByKey(currentConfigNodeKey);
            if ($isBoardNode(boardNode)) {
                boardNode.setConfig(config);

                // Update or create sync service
                const existingService = syncServicesRef.current.get(currentConfigNodeKey);
                if (existingService) {
                    existingService.updateConfig(config);
                } else if (graphCollaboration) {
                    const syncService = new BoardSyncService(
                        editor,
                        graphCollaboration,
                        config,
                        currentConfigNodeKey
                    );
                    syncService.start();
                    syncServicesRef.current.set(currentConfigNodeKey, syncService);
                }
            }
        });

        setShowConfigDialog(false);
        setCurrentConfigNodeKey(null);
        setCurrentConfig(null);
    };

    const handleConfigDialogHide = () => {
        setShowConfigDialog(false);
        setCurrentConfigNodeKey(null);
        setCurrentConfig(null);
    };

    return (
        <>
            {showConfigDialog && createPortal(
                <BoardConfigDialog
                    visible={showConfigDialog}
                    onHide={handleConfigDialogHide}
                    onSelect={handleBoardConfigured}
                    initialConfig={currentConfig || undefined}
                />,
                document.body
            )}
        </>
    );
}
