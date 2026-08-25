import { describe, expect, it } from 'vitest';
import {
  WORKFLOW_PRESET_STORAGE_KEY,
  loadWorkflowPreset,
  saveWorkflowPreset,
  type WorkflowPresetStorage,
} from '../ui/workflowPresetPreference';

function memoryStorage(initial: string | null = null): WorkflowPresetStorage & { value: string | null } {
  return {
    value: initial,
    getItem(key) {
      expect(key).toBe(WORKFLOW_PRESET_STORAGE_KEY);
      return this.value;
    },
    setItem(key, value) {
      expect(key).toBe(WORKFLOW_PRESET_STORAGE_KEY);
      this.value = value;
    },
  };
}

describe('workflow preset preference', () => {
  it('restores the mode the user last picked', () => {
    const storage = memoryStorage();
    saveWorkflowPreset('consult', storage);

    expect(loadWorkflowPreset(storage)).toBe('consult');
  });

  it('ignores a preset this build no longer ships', () => {
    // A stored id is only ever put back by setting the mode with it, so a preset dropped from the
    // catalog has to read as "nothing remembered", not as a mode that cannot run.
    expect(loadWorkflowPreset(memoryStorage('retired-preset'))).toBeUndefined();
  });

  it('reads nothing when the user has never picked a mode', () => {
    expect(loadWorkflowPreset(memoryStorage())).toBeUndefined();
  });
});
