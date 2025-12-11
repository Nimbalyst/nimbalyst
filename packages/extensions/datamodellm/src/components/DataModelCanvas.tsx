/**
 * Data Model Canvas
 *
 * The main visual canvas component using React Flow.
 * Displays entities as nodes and relationships as edges.
 */

import { useCallback, useMemo, useEffect, useRef } from 'react';
import {
  ReactFlow,
  Node,
  Edge,
  Controls,
  Background,
  BackgroundVariant,
  MiniMap,
  useNodesState,
  useEdgesState,
  NodeChange,
  EdgeChange,
  applyNodeChanges,
  applyEdgeChanges,
  type NodeTypes,
  type EdgeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { EntityNode, type EntityNodeData } from './EntityNode';
import { RelationshipEdge, type RelationshipEdgeData } from './RelationshipEdge';
import type { DataModelStoreApi } from '../store';

interface DataModelCanvasProps {
  store: DataModelStoreApi;
  theme: 'light' | 'dark' | 'crystal-dark';
}

export function DataModelCanvas({ store, theme }: DataModelCanvasProps) {
  // Use refs to ensure stable references
  const nodeTypesRef = useRef<NodeTypes>({ entity: EntityNode as any });
  const edgeTypesRef = useRef<EdgeTypes>({ relationship: RelationshipEdge as any });

  // Subscribe to store changes
  const state = store.getState();
  const { entities, relationships, database, entityViewMode, selectedEntityId, selectedRelationshipId, hoveredEntityId } =
    state;

  // Convert entities to React Flow nodes
  const nodes: Node<EntityNodeData>[] = useMemo(
    () =>
      entities.map((entity) => ({
        id: entity.id,
        type: 'entity',
        position: entity.position,
        data: {
          entity,
          isSelected: selectedEntityId === entity.id,
          isHovered: hoveredEntityId === entity.id,
          viewMode: entityViewMode,
          database,
          store,
        },
      })),
    [entities, selectedEntityId, hoveredEntityId, entityViewMode, database, store]
  );

  // Convert relationships to React Flow edges
  const edges: Edge<RelationshipEdgeData>[] = useMemo(() => {
    const validEdges: Edge<RelationshipEdgeData>[] = [];

    for (const relationship of relationships) {
      const sourceEntity = entities.find((e) => e.name === relationship.sourceEntityName);
      const targetEntity = entities.find((e) => e.name === relationship.targetEntityName);

      if (!sourceEntity || !targetEntity) {
        continue;
      }

      // Look up fields by name
      const sourceField =
        relationship.sourceFieldName && sourceEntity
          ? sourceEntity.fields.find((f) => f.name === relationship.sourceFieldName)
          : undefined;

      const targetField =
        relationship.targetFieldName && targetEntity
          ? targetEntity.fields.find((f) => f.name === relationship.targetFieldName)
          : undefined;

      let sourceHandle: string;
      let targetHandle: string;

      // In compact view, always use entity-wide handles
      const useFieldHandles = entityViewMode !== 'compact' && sourceField && targetField;

      if (useFieldHandles) {
        const dx = targetEntity.position.x - sourceEntity.position.x;
        const sourceHandleSide = dx >= 0 ? 'right' : 'left';
        const targetHandleSide = dx >= 0 ? 'left' : 'right';

        sourceHandle = `field-${sourceField.id}-source-${sourceHandleSide}`;
        targetHandle = `field-${targetField.id}-target-${targetHandleSide}`;
      } else {
        const dx = targetEntity.position.x - sourceEntity.position.x;
        const dy = targetEntity.position.y - sourceEntity.position.y;

        if (Math.abs(dx) > Math.abs(dy)) {
          if (dx > 0) {
            sourceHandle = 'source-right';
            targetHandle = 'target-left';
          } else {
            sourceHandle = 'source-left';
            targetHandle = 'target-right';
          }
        } else {
          if (dy > 0) {
            sourceHandle = 'source-bottom';
            targetHandle = 'target-top';
          } else {
            sourceHandle = 'source-top';
            targetHandle = 'target-bottom';
          }
        }
      }

      validEdges.push({
        id: relationship.id,
        type: 'relationship',
        source: sourceEntity.id,
        target: targetEntity.id,
        sourceHandle,
        targetHandle,
        selected: selectedRelationshipId === relationship.id,
        data: { relationship },
      });
    }

    return validEdges;
  }, [relationships, selectedRelationshipId, entities, entityViewMode]);

  const [localNodes, setLocalNodes] = useNodesState(nodes);
  const [localEdges, setLocalEdges] = useEdgesState(edges);

  // Sync nodes when entities change
  useEffect(() => {
    setLocalNodes(nodes);
  }, [nodes, setLocalNodes]);

  // Sync edges when relationships change
  useEffect(() => {
    setLocalEdges(edges);
  }, [edges, setLocalEdges]);

  // Handle node position changes
  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      // Filter out remove changes (we don't want to delete on backspace for now)
      const nonRemoveChanges = changes.filter((change) => change.type !== 'remove');
      setLocalNodes((nds) => applyNodeChanges(nonRemoveChanges, nds));
    },
    [setLocalNodes]
  );

  // Handle node drag stop - save position to store
  const onNodeDragStop = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      store.getState().updateEntity(node.id, { position: node.position });
    },
    [store]
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      // Filter out remove changes
      const nonRemoveChanges = changes.filter((change) => change.type !== 'remove');
      setLocalEdges((eds) => applyEdgeChanges(nonRemoveChanges, eds));
    },
    [setLocalEdges]
  );

  // Handle node click
  const onNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      store.getState().selectEntity(node.id);
    },
    [store]
  );

  // Handle edge click
  const onEdgeClick = useCallback(
    (_event: React.MouseEvent, edge: Edge) => {
      store.getState().selectRelationship(edge.id);
    },
    [store]
  );

  // Handle pane click (deselect)
  const onPaneClick = useCallback(() => {
    store.getState().selectEntity(null);
    store.getState().selectRelationship(null);
  }, [store]);

  // Handle viewport change
  const onMoveEnd = useCallback(
    (_event: unknown, viewport: { x: number; y: number; zoom: number }) => {
      store.getState().setViewport(viewport.x, viewport.y, viewport.zoom);
    },
    [store]
  );

  const isDark = theme === 'dark' || theme === 'crystal-dark';

  return (
    <div className="datamodel-canvas">
      <ReactFlow
        nodes={localNodes}
        edges={localEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDragStop={onNodeDragStop}
        onNodeClick={onNodeClick}
        onEdgeClick={onEdgeClick}
        onPaneClick={onPaneClick}
        onMoveEnd={onMoveEnd}
        nodeTypes={nodeTypesRef.current}
        edgeTypes={edgeTypesRef.current}
        defaultViewport={state.viewport}
        fitView={entities.length > 0 && state.viewport.x === 0 && state.viewport.y === 0}
        minZoom={0.1}
        maxZoom={2}
        snapToGrid
        snapGrid={[20, 20]}
      >
        <Controls className="datamodel-controls" />
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          color={isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}
        />
        <MiniMap
          className="datamodel-minimap"
          nodeColor={isDark ? '#4b5563' : '#e5e7eb'}
          maskColor={isDark ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.6)'}
        />
      </ReactFlow>
    </div>
  );
}
