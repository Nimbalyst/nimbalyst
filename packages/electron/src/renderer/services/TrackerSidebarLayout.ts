import type { TrackerDataModel } from '@nimbalyst/runtime';

export type SidebarEntry =
  | { kind: 'folder'; name: string; collapsed?: boolean; types: string[] }
  | { kind: 'type'; typeId: string };

export interface TrackerSidebarLayout {
  entries: SidebarEntry[];
}

export const EMPTY_LAYOUT: TrackerSidebarLayout = { entries: [] };

export function reconcileLayout(
  layout: TrackerSidebarLayout,
  models: TrackerDataModel[]
): TrackerSidebarLayout {
  const known = new Set<string>();
  const knownFolders = new Set<string>();
  const next: SidebarEntry[] = [];

  for (const entry of layout.entries) {
    if (entry.kind === 'folder') {
      const types = entry.types.filter((t) => models.some((m) => m.type === t));
      for (const t of types) known.add(t);
      knownFolders.add(entry.name);
      next.push({ ...entry, types });
    } else {
      if (models.some((m) => m.type === entry.typeId)) {
        known.add(entry.typeId);
        next.push(entry);
      }
    }
  }

  for (const model of models) {
    if (known.has(model.type)) continue;
    if (model.group && knownFolders.has(model.group)) {
      const folder = next.find(
        (e) => e.kind === 'folder' && e.name === model.group
      ) as Extract<SidebarEntry, { kind: 'folder' }> | undefined;
      if (folder) {
        folder.types.push(model.type);
        continue;
      }
    }
    next.push({ kind: 'type', typeId: model.type });
  }

  return { entries: next };
}

export function buildLayoutFromLegacy(
  models: TrackerDataModel[],
  oldFolders: Array<{ name: string; collapsed?: boolean; order: number }>,
  oldOverrides: Record<string, string | null>
): TrackerSidebarLayout {
  const sortedFolders = [...oldFolders].sort((a, b) => a.order - b.order);
  const folderMap = new Map<string, Extract<SidebarEntry, { kind: 'folder' }>>();
  const entries: SidebarEntry[] = [];

  for (const folder of sortedFolders) {
    const entry: Extract<SidebarEntry, { kind: 'folder' }> = {
      kind: 'folder',
      name: folder.name,
      collapsed: folder.collapsed,
      types: [],
    };
    folderMap.set(folder.name, entry);
    entries.push(entry);
  }

  for (const model of models) {
    let folderName: string | null;
    if (model.type in oldOverrides) {
      folderName = oldOverrides[model.type];
    } else {
      folderName = model.group ?? null;
    }
    if (folderName && folderMap.has(folderName)) {
      folderMap.get(folderName)!.types.push(model.type);
    } else {
      entries.push({ kind: 'type', typeId: model.type });
    }
  }

  return { entries };
}

export async function loadLayout(workspacePath: string): Promise<TrackerSidebarLayout> {
  try {
    const state = await (window as any).electronAPI.invoke('workspace:get-state', workspacePath);
    if (state?.trackerSidebarLayout?.entries) {
      return state.trackerSidebarLayout as TrackerSidebarLayout;
    }
    return EMPTY_LAYOUT;
  } catch {
    return EMPTY_LAYOUT;
  }
}

export async function saveLayout(
  workspacePath: string,
  layout: TrackerSidebarLayout
): Promise<void> {
  await (window as any).electronAPI.invoke('workspace:update-state', workspacePath, {
    trackerSidebarLayout: layout,
  });
}

export async function loadLegacyState(workspacePath: string): Promise<{
  folders: Array<{ name: string; collapsed?: boolean; order: number }>;
  overrides: Record<string, string | null>;
}> {
  try {
    const state = await (window as any).electronAPI.invoke('workspace:get-state', workspacePath);
    return {
      folders: Array.isArray(state?.trackerFolders) ? state.trackerFolders : [],
      overrides: state?.trackerFolderOverrides ?? {},
    };
  } catch {
    return { folders: [], overrides: {} };
  }
}

// ============================================================================
// Layout mutation operations (immutable — return new layout)
// ============================================================================

export interface DragLocation {
  kind: 'folder' | 'type';
  id: string;
  fromFolder?: string | null;
}

export interface DropLocation {
  position: 'before' | 'after' | 'inside';
  target: number[];
}

export function moveEntry(
  layout: TrackerSidebarLayout,
  drag: DragLocation,
  drop: DropLocation
): TrackerSidebarLayout {
  const entries: SidebarEntry[] = layout.entries.map((e) =>
    e.kind === 'folder' ? { ...e, types: [...e.types] } : { ...e }
  );

  let dragged: SidebarEntry | null = null;
  if (drag.kind === 'folder') {
    const idx = entries.findIndex((e) => e.kind === 'folder' && e.name === drag.id);
    if (idx >= 0) {
      dragged = entries[idx];
      entries.splice(idx, 1);
    }
  } else {
    if (drag.fromFolder == null) {
      const idx = entries.findIndex((e) => e.kind === 'type' && e.typeId === drag.id);
      if (idx >= 0) {
        dragged = entries[idx];
        entries.splice(idx, 1);
      }
    } else {
      const folder = entries.find(
        (e) => e.kind === 'folder' && e.name === drag.fromFolder
      ) as Extract<SidebarEntry, { kind: 'folder' }> | undefined;
      if (folder) {
        const idx = folder.types.indexOf(drag.id);
        if (idx >= 0) {
          folder.types.splice(idx, 1);
          dragged = { kind: 'type', typeId: drag.id };
        }
      }
    }
  }
  if (dragged == null) return layout;

  if (drop.position === 'inside') {
    const folderIdx = drop.target[0];
    const folder = entries[folderIdx];
    if (folder?.kind === 'folder' && dragged.kind === 'type') {
      folder.types.push(dragged.typeId);
    } else if (folder?.kind === 'folder' && dragged.kind === 'folder') {
      return layout;
    }
    return { entries };
  }

  if (drop.target.length === 1) {
    const idx = drop.target[0];
    const insertAt = drop.position === 'before' ? idx : idx + 1;
    entries.splice(insertAt, 0, dragged);
    return { entries };
  }

  if (drop.target.length === 2 && dragged.kind === 'type') {
    const folderIdx = drop.target[0];
    const folder = entries[folderIdx];
    if (folder?.kind === 'folder') {
      const typeIdx = drop.target[1];
      const insertAt = drop.position === 'before' ? typeIdx : typeIdx + 1;
      folder.types.splice(insertAt, 0, dragged.typeId);
    }
    return { entries };
  }

  return layout;
}

export function setFolderCollapsed(
  layout: TrackerSidebarLayout,
  folderName: string,
  collapsed: boolean
): TrackerSidebarLayout {
  const entries = layout.entries.map((e) => {
    if (e.kind === 'folder' && e.name === folderName) {
      return { ...e, collapsed };
    }
    return e;
  });
  return { entries };
}

export function addFolder(
  layout: TrackerSidebarLayout,
  name: string
): TrackerSidebarLayout {
  if (layout.entries.some((e) => e.kind === 'folder' && e.name === name)) {
    return layout;
  }
  return {
    entries: [...layout.entries, { kind: 'folder', name, collapsed: false, types: [] }],
  };
}

export function renameFolder(
  layout: TrackerSidebarLayout,
  oldName: string,
  newName: string
): TrackerSidebarLayout {
  if (oldName === newName) return layout;
  if (layout.entries.some((e) => e.kind === 'folder' && e.name === newName)) return layout;
  return {
    entries: layout.entries.map((e) =>
      e.kind === 'folder' && e.name === oldName ? { ...e, name: newName } : e
    ),
  };
}

export function deleteFolder(
  layout: TrackerSidebarLayout,
  folderName: string
): TrackerSidebarLayout {
  const entries: SidebarEntry[] = [];
  for (const e of layout.entries) {
    if (e.kind === 'folder' && e.name === folderName) {
      for (const t of e.types) entries.push({ kind: 'type', typeId: t });
    } else {
      entries.push(e);
    }
  }
  return { entries };
}

export function assignTypeToFolder(
  layout: TrackerSidebarLayout,
  typeId: string,
  targetFolder: string | null
): TrackerSidebarLayout {
  const entries: SidebarEntry[] = layout.entries.map((e) =>
    e.kind === 'folder' ? { ...e, types: [...e.types] } : { ...e }
  );

  // Remove from current location
  for (const entry of entries) {
    if (entry.kind === 'folder') {
      const idx = entry.types.indexOf(typeId);
      if (idx >= 0) {
        entry.types.splice(idx, 1);
      }
    }
  }
  const topLevelIdx = entries.findIndex((e) => e.kind === 'type' && e.typeId === typeId);
  if (topLevelIdx >= 0) {
    entries.splice(topLevelIdx, 1);
  }

  // Insert into target location
  if (targetFolder != null) {
    const folder = entries.find(
      (e) => e.kind === 'folder' && e.name === targetFolder
    ) as Extract<SidebarEntry, { kind: 'folder' }> | undefined;
    if (folder) {
      folder.types.push(typeId);
    } else {
      entries.push({ kind: 'type', typeId });
    }
  } else {
    entries.push({ kind: 'type', typeId });
  }

  return { entries };
}
