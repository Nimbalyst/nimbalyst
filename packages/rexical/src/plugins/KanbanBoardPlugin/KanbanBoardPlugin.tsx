import {useLexicalComposerContext} from '@lexical/react/LexicalComposerContext';
import {useEffect, useRef, useState} from 'react';
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
} from './BoardCommands';
import {
    KanbanBoardNode,
    $isBoardNode,
} from './KanbanBoardNode';
import {
    BoardHeaderNode,
    $isBoardHeaderNode,
    $createBoardHeaderNode,
} from './BoardHeaderNode';
import {
    BoardColumnNode,
    $isColumnNode,
    $createColumnNode,
} from './BoardColumnNode';
import {
    BoardColumnHeaderNode,
    $createColumnHeaderNode,
} from './BoardColumnHeaderNode';
import {
    BoardColumnContentNode,
    $isColumnContentNode,
    $createColumnContentNode,
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
import {CardEditDialog} from './CardEditDialog';
import {CardData} from './BoardCardNode';
import {createPortal} from 'react-dom';
import {registerBoardTransformCommands} from './BoardTransformCommands';

export function KanbanBoardPlugin(): JSX.Element | null {
    const [editor] = useLexicalComposerContext();
    const graphCollaboration = useGraphCollaboration();
    const syncServicesRef = useRef<Map<string, BoardSyncService>>(new Map());
    const [showConfigDialog, setShowConfigDialog] = useState(false);
    const [currentConfigNodeKey, setCurrentConfigNodeKey] = useState<string | null>(null);
    const [currentConfig, setCurrentConfig] = useState<BoardConfig | null>(null);
    const [showCardEditDialog, setShowCardEditDialog] = useState(false);
    const [currentEditCardKey, setCurrentEditCardKey] = useState<string | null>(null);
    const [currentCardData, setCurrentCardData] = useState<CardData>({ title: '' });

    // Use refs to store the latest state setters to avoid stale closures
    const setShowCardEditDialogRef = useRef(setShowCardEditDialog);
    const setCurrentEditCardKeyRef = useRef(setCurrentEditCardKey);
    const setCurrentCardDataRef = useRef(setCurrentCardData);

    useEffect(() => {
        setShowCardEditDialogRef.current = setShowCardEditDialog;
        setCurrentEditCardKeyRef.current = setCurrentEditCardKey;
        setCurrentCardDataRef.current = setCurrentCardData;
    });

    useEffect(() => {
        // console.log("KanbanBoardPlugin mounted");
        if (!editor.hasNodes([KanbanBoardNode, BoardHeaderNode, BoardColumnNode, BoardColumnHeaderNode, BoardColumnContentNode, BoardCardNode])) {
            throw new Error(
                'KanbanBoardPlugin: Required nodes not registered on editor',
            );
        }

        const unregisterCommands = registerKanbanCommands(editor);
        const unregisterTransformCommands = registerBoardTransformCommands();

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
            const { boardNodeKey } = event.detail;

            // Only handle if this board belongs to this editor instance
            editor.getEditorState().read(() => {
                const node = $getNodeByKey(boardNodeKey);
                if (!node) {
                    return;
                }
                if ($isBoardNode(node)) {
                    const config = node.getConfig();
                    setCurrentConfigNodeKey(boardNodeKey);
                    setCurrentConfig(config);
                    setShowConfigDialog(true);
                }
            });
        };

        window.addEventListener('board-configure', handleBoardConfigure as EventListener);

        // Handle add card events
        const handleAddCard = (event: CustomEvent) => {
            const { contentNodeKey } = event.detail;

            editor.update(() => {
                const contentNode = $getNodeByKey(contentNodeKey);
                if (!contentNode) {
                    return;
                }
                if ($isColumnContentNode(contentNode)) {
                    // Create a new card with editable content
                    const newCard = $createCardNode();
                    const paragraph = $createParagraphNode();
                    paragraph.append($createTextNode('New card'));
                    newCard.append(paragraph);
                    contentNode.append(newCard);

                    // Select the new card text for editing
                    paragraph.select();
                }
            });
        };

        window.addEventListener('board-add-card', handleAddCard as EventListener);

        // Handle add column events
        const handleAddColumn = (event: CustomEvent) => {
            const { boardNodeKey } = event.detail;

            editor.update(() => {
                const boardNode = $getNodeByKey(boardNodeKey);
                if (!boardNode) {
                    return;
                }
                if ($isBoardNode(boardNode)) {
                    // Create a new column with header and content
                    const column = $createColumnNode();

                    // Create header with default title
                    const header = $createColumnHeaderNode();
                    const headerParagraph = $createParagraphNode();
                    headerParagraph.append($createTextNode('New Column'));
                    header.append(headerParagraph);

                    // Create content area for cards
                    const content = $createColumnContentNode();

                    column.append(header, content);
                    boardNode.append(column);

                    // Select the header text for editing
                    headerParagraph.select();
                }
            });
        };

        window.addEventListener('board-add-column', handleAddColumn as EventListener);

        // Handle delete column events
        const handleDeleteColumn = (event: CustomEvent) => {
            const { columnNodeKey } = event.detail;

            editor.update(() => {
                // Find the column node by traversing from the header
                const headerNode = $getNodeByKey(columnNodeKey);
                if (!headerNode) {
                    return;
                }
                // The header's parent should be the column
                const columnNode = headerNode.getParent();
                if ($isColumnNode(columnNode)) {
                    columnNode.remove();
                }
            });
        };

        window.addEventListener('board-delete-column', handleDeleteColumn as EventListener);

        // Handle delete card events
        const handleDeleteCard = (event: CustomEvent) => {
            const { cardNodeKey } = event.detail;

            editor.update(() => {
                const cardNode = $getNodeByKey(cardNodeKey);
                if (!cardNode) {
                    // Card not in this editor instance, ignore
                    return;
                }
                if ($isCardNode(cardNode)) {
                    cardNode.remove();
                }
            });
        };

        window.addEventListener('board-delete-card', handleDeleteCard as EventListener);

        // Handle edit card events
        const handleEditCard = (event: CustomEvent) => {
            const { cardNodeKey, currentData } = event.detail;

            // Only handle if this card belongs to this editor instance
            editor.getEditorState().read(() => {
                const node = $getNodeByKey(cardNodeKey);
                if (!node) {
                    return;
                }

                setCurrentEditCardKeyRef.current(cardNodeKey);
                setCurrentCardDataRef.current(currentData);
                setShowCardEditDialogRef.current(true);
            });
        };

        window.addEventListener('board-edit-card', handleEditCard as EventListener);

        // Helper function to reset column visual feedback
        const resetColumnVisualFeedback = () => {
            const allColumnContents = document.querySelectorAll('.kanban-column-content');
            allColumnContents.forEach((content) => {
                const element = content as HTMLElement;
                element.style.backgroundColor = '';
                element.style.borderColor = '';
                element.style.borderStyle = '';
            });
        };

        // Global dragend listener to ensure cleanup
        const handleDragEnd = () => {
            resetColumnVisualFeedback();
        };

        document.addEventListener('dragend', handleDragEnd);
        document.addEventListener('dragleave', (e) => {
            // If we're leaving the board entirely, reset
            const target = e.target as HTMLElement;
            if (target.classList.contains('kanban-board')) {
                resetColumnVisualFeedback();
            }
        });

        // Register drag and drop commands following Lexical's pattern
        const unregisterDragDrop = mergeRegister(
            editor.registerCommand(
                DRAGOVER_COMMAND,
                (event: DragEvent) => {
                    const target = event.target as HTMLElement;
                    const columnContent = target.closest('.kanban-column-content');

                    // First reset all columns
                    resetColumnVisualFeedback();

                    if (columnContent && event.dataTransfer?.types.includes('application/x-kanban-card')) {
                        event.preventDefault();
                        // Add visual feedback to current column
                        const htmlColumnContent = columnContent as HTMLElement;
                        htmlColumnContent.style.backgroundColor = '#f0f8ff';
                        htmlColumnContent.style.borderColor = '#4a90e2';
                        htmlColumnContent.style.borderStyle = 'dashed';
                        return true;
                    }

                    return false;
                },
                COMMAND_PRIORITY_LOW,
            ),

            editor.registerCommand(
                DROP_COMMAND,
                (event: DragEvent) => {
                    // Always reset visual feedback when drop occurs
                    resetColumnVisualFeedback();

                    const target = event.target as HTMLElement;
                    const columnContent = target.closest('.kanban-column-content');
                    const column = target.closest('.kanban-column');

                    if (!columnContent || !column || !event.dataTransfer?.types.includes('application/x-kanban-card')) {
                        return false;
                    }

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
                        // Get the card's data to preserve all fields
                        const cardData = sourceCardNode.getData();

                        // Remove the original card
                        sourceCardNode.remove();

                        // Create a new card with the same content and data using proper Lexical functions
                        const newCard = $createCardNode(cardId, cardData);
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
            unregisterTransformCommands();
            unregisterDragDrop();
            window.removeEventListener('board-created', handleBoardCreated as EventListener);
            window.removeEventListener('board-configure', handleBoardConfigure as EventListener);
            window.removeEventListener('board-add-card', handleAddCard as EventListener);
            window.removeEventListener('board-add-column', handleAddColumn as EventListener);
            window.removeEventListener('board-delete-column', handleDeleteColumn as EventListener);
            window.removeEventListener('board-delete-card', handleDeleteCard as EventListener);
            window.removeEventListener('board-edit-card', handleEditCard as EventListener);
            document.removeEventListener('dragend', handleDragEnd);

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
                // setConfig will automatically mark all descendants as dirty
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

    const handleCardEditSave = (data: CardData) => {
        if (!currentEditCardKey) return;

        editor.update(() => {
            const cardNode = $getNodeByKey(currentEditCardKey);
            if ($isCardNode(cardNode)) {
                // Get the parent before modifying
                const parent = cardNode.getParent();
                const index = parent ? parent.getChildren().indexOf(cardNode) : -1;

                // Create a new card with updated data
                const newCard = $createCardNode(cardNode.getId(), data);

                // Copy the text content
                const paragraph = $createParagraphNode();
                paragraph.append($createTextNode(data.title || 'Untitled'));
                newCard.append(paragraph);

                // Replace the old card with the new one
                if (parent && index !== -1) {
                    cardNode.replace(newCard);
                }
            }
        });

        setShowCardEditDialog(false);
        setCurrentEditCardKey(null);
    };

    const handleCardEditHide = () => {
        setShowCardEditDialog(false);
        setCurrentEditCardKey(null);
    };

    const editorContainer = document.querySelector('.stravu-editor.active');
    const portalTarget = editorContainer || document.body;

    return (
        <>
            {showConfigDialog && createPortal(
                <BoardConfigDialog
                    visible={showConfigDialog}
                    onHide={handleConfigDialogHide}
                    onSelect={handleBoardConfigured}
                    initialConfig={currentConfig || undefined}
                />,
                portalTarget
            )}
            {showCardEditDialog && createPortal(
                <CardEditDialog
                    visible={showCardEditDialog}
                    onHide={handleCardEditHide}
                    onSave={handleCardEditSave}
                    initialData={currentCardData}
                />,
                portalTarget
            )}
        </>
    );
}
