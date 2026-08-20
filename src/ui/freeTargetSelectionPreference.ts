import type { AIProvider } from '../../shared/types';

export const FREE_TARGET_SELECTION_STORAGE_KEY = 'multi-ai-chat:free-target-selection:v1';

export interface FreeTargetSelectionStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface StoredFreeTargetSelection {
  targets: AIProvider[];
  userTouched: boolean;
}

export function loadFreeTargetSelection(
  validProviders: readonly AIProvider[],
  storage: FreeTargetSelectionStorage | undefined = defaultStorage(),
): StoredFreeTargetSelection | undefined {
  if (!storage) return undefined;
  try {
    const raw = storage.getItem(FREE_TARGET_SELECTION_STORAGE_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.targets)) return undefined;
    const validSet = new Set<string>(validProviders);
    const targets = parsed.targets.filter((item: unknown): item is AIProvider => validSet.has(item as string));
    return { targets, userTouched: parsed.userTouched === true };
  } catch {
    return undefined;
  }
}

export function saveFreeTargetSelection(
  selection: StoredFreeTargetSelection,
  storage: FreeTargetSelectionStorage | undefined = defaultStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(FREE_TARGET_SELECTION_STORAGE_KEY, JSON.stringify(selection));
  } catch {
    // storage full or unavailable; selection just won't survive restart
  }
}

function defaultStorage(): FreeTargetSelectionStorage | undefined {
  return typeof window === 'undefined' ? undefined : window.localStorage;
}
