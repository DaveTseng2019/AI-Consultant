import { describe, expect, it } from 'vitest';
import { isStopShortcut, type StopShortcutEvent } from '../ui/stopShortcut';

const ctrlC: StopShortcutEvent = { key: 'c', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, isComposing: false };

describe('isStopShortcut', () => {
  it('stops the run on Ctrl+C when nothing is selected', () => {
    expect(isStopShortcut(ctrlC, '')).toBe(true);
    // Caps Lock on still means Ctrl+C.
    expect(isStopShortcut({ ...ctrlC, key: 'C' }, '')).toBe(true);
  });

  it('lets Ctrl+C copy when text is selected, so answers stay copyable during a run', () => {
    expect(isStopShortcut(ctrlC, 'part of an answer')).toBe(false);
  });

  it('ignores other chords and IME composition', () => {
    expect(isStopShortcut({ ...ctrlC, shiftKey: true }, '')).toBe(false);
    expect(isStopShortcut({ ...ctrlC, altKey: true }, '')).toBe(false);
    expect(isStopShortcut({ ...ctrlC, metaKey: true }, '')).toBe(false);
    expect(isStopShortcut({ ...ctrlC, ctrlKey: false }, '')).toBe(false);
    expect(isStopShortcut({ ...ctrlC, key: 'v' }, '')).toBe(false);
    expect(isStopShortcut({ ...ctrlC, isComposing: true }, '')).toBe(false);
  });
});
