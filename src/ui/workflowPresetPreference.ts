import type { WorkflowPresetId } from '../../shared/types';
import { PRESET_CATALOG } from './presetCatalogData';

export const WORKFLOW_PRESET_STORAGE_KEY = 'ai-consultant:workflow-preset:v1';

export interface WorkflowPresetStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

// What is stored here is the mode to come back up in, and it is read on startup only. It is written
// from one place -- the user picking a mode off the catalog -- so the mode a conversation carries
// can be shown when that conversation is opened from the history without becoming the mode the app
// starts in tomorrow. Being shown a mode is not choosing one.
export function loadWorkflowPreset(
  storage: WorkflowPresetStorage | undefined = defaultStorage(),
): WorkflowPresetId | undefined {
  if (!storage) return undefined;
  try {
    const raw = storage.getItem(WORKFLOW_PRESET_STORAGE_KEY);
    if (!raw) return undefined;
    return PRESET_CATALOG.some((preset) => preset.id === raw) ? (raw as WorkflowPresetId) : undefined;
  } catch {
    return undefined;
  }
}

export function saveWorkflowPreset(
  presetId: WorkflowPresetId,
  storage: WorkflowPresetStorage | undefined = defaultStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(WORKFLOW_PRESET_STORAGE_KEY, presetId);
  } catch {
    // storage full or unavailable; the mode just won't survive restart
  }
}

function defaultStorage(): WorkflowPresetStorage | undefined {
  return typeof window === 'undefined' ? undefined : window.localStorage;
}
