import type { WorkflowPresetId } from '../../shared/types';
import { PRESET_CATALOG } from './presetCatalogData';

export const WORKFLOW_PRESET_STORAGE_KEY = 'ai-consultant:workflow-preset:v1';

export interface WorkflowPresetStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

// A start that opens a new conversation resets the mode to free, which loses the one the user works
// in every day. Remember the last mode they picked and put it back on that start only: a new
// conversation asked for by hand still resets, because that is what the button is for.
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
