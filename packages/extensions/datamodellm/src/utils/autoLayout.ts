/**
 * Auto-Layout Algorithm for Data Model Entities
 *
 * Uses a graph-based approach to position entities:
 * 1. Build a relationship graph
 * 2. Find connected components (groups of related entities)
 * 3. Position entities within each group using a layered approach
 * 4. Position groups relative to each other
 */

import type { Entity, Relationship } from '../types';

interface LayoutConfig {
  /** Horizontal spacing between entities */
  horizontalGap: number;
  /** Vertical spacing between entities */
  verticalGap: number;
  /** Estimated entity width for layout calculations */
  entityWidth: number;
  /** Estimated entity height for layout calculations */
  entityHeight: number;
  /** Spacing between disconnected groups */
  groupGap: number;
}

const DEFAULT_CONFIG: LayoutConfig = {
  horizontalGap: 100,
  verticalGap: 80,
  entityWidth: 280,
  entityHeight: 200,
  groupGap: 150,
};

/**
 * Build an adjacency list from relationships
 */
function buildAdjacencyList(
  entities: Entity[],
  relationships: Relationship[]
): Map<string, Set<string>> {
  const nameToId = new Map(entities.map((e) => [e.name, e.id]));
  const adjacency = new Map<string, Set<string>>();

  // Initialize all entities
  for (const entity of entities) {
    adjacency.set(entity.id, new Set());
  }

  // Add relationship edges (bidirectional for layout purposes)
  for (const rel of relationships) {
    const sourceId = nameToId.get(rel.sourceEntityName);
    const targetId = nameToId.get(rel.targetEntityName);

    if (sourceId && targetId) {
      adjacency.get(sourceId)?.add(targetId);
      adjacency.get(targetId)?.add(sourceId);
    }
  }

  return adjacency;
}

/**
 * Find connected components using DFS
 */
function findConnectedComponents(
  entities: Entity[],
  adjacency: Map<string, Set<string>>
): Entity[][] {
  const visited = new Set<string>();
  const components: Entity[][] = [];
  const idToEntity = new Map(entities.map((e) => [e.id, e]));

  function dfs(entityId: string, component: Entity[]) {
    if (visited.has(entityId)) return;
    visited.add(entityId);

    const entity = idToEntity.get(entityId);
    if (entity) {
      component.push(entity);
    }

    const neighbors = adjacency.get(entityId) || new Set();
    for (const neighborId of neighbors) {
      dfs(neighborId, component);
    }
  }

  for (const entity of entities) {
    if (!visited.has(entity.id)) {
      const component: Entity[] = [];
      dfs(entity.id, component);
      if (component.length > 0) {
        components.push(component);
      }
    }
  }

  return components;
}

/**
 * Topological sort with levels for layered layout
 * Returns entities grouped by their "level" in the graph
 */
function assignLayers(
  entities: Entity[],
  relationships: Relationship[]
): Map<string, number> {
  const nameToEntity = new Map(entities.map((e) => [e.name, e]));
  const levels = new Map<string, number>();

  // Find entities that are not targets (roots)
  const targetNames = new Set(relationships.map((r) => r.targetEntityName));
  const roots = entities.filter((e) => !targetNames.has(e.name));

  // If no roots found, just use the first entity
  if (roots.length === 0 && entities.length > 0) {
    roots.push(entities[0]);
  }

  // BFS to assign levels
  const queue: { entity: Entity; level: number }[] = roots.map((e) => ({
    entity: e,
    level: 0,
  }));
  const visited = new Set<string>();

  while (queue.length > 0) {
    const { entity, level } = queue.shift()!;

    if (visited.has(entity.id)) {
      // Update level if we found a longer path
      const currentLevel = levels.get(entity.id) || 0;
      if (level > currentLevel) {
        levels.set(entity.id, level);
      }
      continue;
    }

    visited.add(entity.id);
    levels.set(entity.id, level);

    // Find relationships where this entity is the source
    for (const rel of relationships) {
      if (rel.sourceEntityName === entity.name) {
        const targetEntity = nameToEntity.get(rel.targetEntityName);
        if (targetEntity && !visited.has(targetEntity.id)) {
          queue.push({ entity: targetEntity, level: level + 1 });
        }
      }
    }
  }

  // Handle unvisited entities (disconnected within the component)
  for (const entity of entities) {
    if (!levels.has(entity.id)) {
      levels.set(entity.id, 0);
    }
  }

  return levels;
}

/**
 * Layout a single connected component
 * Returns the bounding box width and height
 */
function layoutComponent(
  entities: Entity[],
  relationships: Relationship[],
  startX: number,
  startY: number,
  config: LayoutConfig
): { positions: Map<string, { x: number; y: number }>; width: number; height: number } {
  const positions = new Map<string, { x: number; y: number }>();

  if (entities.length === 0) {
    return { positions, width: 0, height: 0 };
  }

  if (entities.length === 1) {
    positions.set(entities[0].id, { x: startX, y: startY });
    return { positions, width: config.entityWidth, height: config.entityHeight };
  }

  // Assign layers based on relationship direction
  const levels = assignLayers(entities, relationships);

  // Group entities by level
  const levelGroups = new Map<number, Entity[]>();
  for (const entity of entities) {
    const level = levels.get(entity.id) || 0;
    if (!levelGroups.has(level)) {
      levelGroups.set(level, []);
    }
    levelGroups.get(level)!.push(entity);
  }

  // Sort levels
  const sortedLevels = Array.from(levelGroups.keys()).sort((a, b) => a - b);

  // Calculate positions
  let maxWidth = 0;
  let currentY = startY;

  for (const level of sortedLevels) {
    const group = levelGroups.get(level)!;
    const groupWidth =
      group.length * config.entityWidth + (group.length - 1) * config.horizontalGap;
    maxWidth = Math.max(maxWidth, groupWidth);

    // Center the group
    let currentX = startX;

    for (let i = 0; i < group.length; i++) {
      positions.set(group[i].id, {
        x: currentX + i * (config.entityWidth + config.horizontalGap),
        y: currentY,
      });
    }

    currentY += config.entityHeight + config.verticalGap;
  }

  const totalHeight = currentY - startY - config.verticalGap;

  return { positions, width: maxWidth, height: totalHeight };
}

/**
 * Auto-layout all entities considering relationships
 */
export function autoLayoutEntities(
  entities: Entity[],
  relationships: Relationship[],
  config: Partial<LayoutConfig> = {}
): Map<string, { x: number; y: number }> {
  const fullConfig = { ...DEFAULT_CONFIG, ...config };
  const allPositions = new Map<string, { x: number; y: number }>();

  if (entities.length === 0) {
    return allPositions;
  }

  // Build adjacency list and find connected components
  const adjacency = buildAdjacencyList(entities, relationships);
  const components = findConnectedComponents(entities, adjacency);

  // Sort components by size (largest first)
  components.sort((a, b) => b.length - a.length);

  // Layout each component
  let currentX = 100;
  let currentY = 100;
  let maxHeightInRow = 0;
  let rowWidth = 0;
  const maxRowWidth = 1500; // Max width before wrapping to next row

  for (const component of components) {
    // Filter relationships to only those within this component
    const componentNames = new Set(component.map((e) => e.name));
    const componentRelationships = relationships.filter(
      (r) =>
        componentNames.has(r.sourceEntityName) && componentNames.has(r.targetEntityName)
    );

    const { positions, width, height } = layoutComponent(
      component,
      componentRelationships,
      currentX,
      currentY,
      fullConfig
    );

    // Merge positions
    for (const [id, pos] of positions) {
      allPositions.set(id, pos);
    }

    // Update position for next component
    rowWidth += width + fullConfig.groupGap;
    maxHeightInRow = Math.max(maxHeightInRow, height);

    if (rowWidth > maxRowWidth) {
      // Start new row
      currentX = 100;
      currentY += maxHeightInRow + fullConfig.groupGap;
      rowWidth = 0;
      maxHeightInRow = 0;
    } else {
      currentX += width + fullConfig.groupGap;
    }
  }

  return allPositions;
}
