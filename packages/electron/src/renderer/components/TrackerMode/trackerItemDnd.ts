import type { DragEvent } from 'react';
import { globalRegistry } from '@nimbalyst/runtime/plugins/TrackerPlugin/models';
import type { TrackerDataModel } from '@nimbalyst/runtime/plugins/TrackerPlugin/models';

export const TRACKER_ITEM_DND_MIME = 'application/x-nimbalyst-tracker-item';

export interface DraggedTrackerItem {
  itemId: string;
  primaryType: string;
  typeTags: string[];
  currentDataKeys: string[];
  data: Record<string, any>;
  key: string;
}

export function setDragPayload(e: DragEvent, payload: DraggedTrackerItem): void {
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData(TRACKER_ITEM_DND_MIME, JSON.stringify(payload));
}

export function readDragPayload(e: DragEvent): DraggedTrackerItem | null {
  const raw = e.dataTransfer.getData(TRACKER_ITEM_DND_MIME);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as DraggedTrackerItem;
  } catch {
    return null;
  }
}

export function computeFieldLoss(
  currentDataKeys: string[],
  targetType: string
): { lostFields: string[]; targetModel: TrackerDataModel | null } {
  const targetModel = globalRegistry.get(targetType) ?? null;
  if (!targetModel) return { lostFields: [], targetModel: null };
  const targetFieldNames = new Set(targetModel.fields.map((f) => f.name));
  const lostFields = currentDataKeys.filter((k) => !targetFieldNames.has(k));
  return { lostFields, targetModel };
}

export function buildNewTypeTags(
  currentTags: string[],
  currentPrimary: string,
  targetType: string
): string[] {
  const filtered = currentTags.filter((t) => t !== currentPrimary && t !== targetType);
  return [targetType, ...filtered];
}

export function regenerateKey(currentKey: string, targetIdPrefix: string): string {
  const dashIdx = currentKey.lastIndexOf('-');
  if (dashIdx < 0) return `${targetIdPrefix.toUpperCase()}-${currentKey}`;
  const suffix = currentKey.slice(dashIdx + 1);
  return `${targetIdPrefix.toUpperCase()}-${suffix}`;
}

export function migrateData(
  currentData: Record<string, any>,
  targetType: string
): Record<string, any> {
  const targetModel = globalRegistry.get(targetType);
  if (!targetModel) return currentData;
  const targetFieldNames = new Set(targetModel.fields.map((f) => f.name));
  const next: Record<string, any> = {};
  for (const key of Object.keys(currentData)) {
    if (targetFieldNames.has(key)) next[key] = currentData[key];
  }
  return next;
}
