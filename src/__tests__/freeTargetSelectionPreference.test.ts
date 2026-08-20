import { describe, expect, it } from 'vitest';
import {
  FREE_TARGET_SELECTION_STORAGE_KEY,
  loadFreeTargetSelection,
  saveFreeTargetSelection,
  type FreeTargetSelectionStorage,
} from '../ui/freeTargetSelectionPreference';

const PROVIDERS = ['chatgpt', 'claude', 'gemini', 'grok'] as const;

function memoryStorage(initial: string | null = null): FreeTargetSelectionStorage & { value: string | null } {
  return {
    value: initial,
    getItem(key) {
      expect(key).toBe(FREE_TARGET_SELECTION_STORAGE_KEY);
      return this.value;
    },
    setItem(key, value) {
      expect(key).toBe(FREE_TARGET_SELECTION_STORAGE_KEY);
      this.value = value;
    },
  };
}

describe('free target selection preference', () => {
  it('round-trips a user-touched selection', () => {
    const storage = memoryStorage();

    saveFreeTargetSelection({ targets: ['claude', 'gemini'], userTouched: true }, storage);

    expect(loadFreeTargetSelection([...PROVIDERS], storage)).toEqual({
      targets: ['claude', 'gemini'],
      userTouched: true,
    });
  });

  it('drops providers that no longer exist', () => {
    const storage = memoryStorage();
    saveFreeTargetSelection({ targets: ['claude', 'retired-provider' as never], userTouched: true }, storage);

    expect(loadFreeTargetSelection([...PROVIDERS], storage)).toEqual({
      targets: ['claude'],
      userTouched: true,
    });
  });

  it('falls back safely when storage is empty, unavailable, or throws', () => {
    const throwingStorage: FreeTargetSelectionStorage = {
      getItem: () => {
        throw new Error('read denied');
      },
      setItem: () => {
        throw new Error('write denied');
      },
    };

    expect(loadFreeTargetSelection([...PROVIDERS], memoryStorage())).toBeUndefined();
    expect(loadFreeTargetSelection([...PROVIDERS], undefined)).toBeUndefined();
    expect(loadFreeTargetSelection([...PROVIDERS], throwingStorage)).toBeUndefined();
    expect(() => saveFreeTargetSelection({ targets: ['claude'], userTouched: true }, throwingStorage)).not.toThrow();
  });
});
