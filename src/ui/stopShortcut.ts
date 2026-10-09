export interface StopShortcutEvent {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  isComposing: boolean;
}

/**
 * Ctrl+C stops a running workflow, the way it stops a command in a terminal. It still copies
 * whenever something is selected: taking that away would make the answer on screen uncopyable
 * for as long as the run lasts.
 */
export function isStopShortcut(event: StopShortcutEvent, selectedText: string): boolean {
  if (event.isComposing || event.metaKey || event.altKey || event.shiftKey || !event.ctrlKey) return false;
  if (event.key.toLowerCase() !== 'c') return false;
  return selectedText.length === 0;
}

/** window.getSelection() does not see a selection inside a textarea or input, so read those directly. */
export function currentSelectionText(): string {
  const active = document.activeElement;
  if (active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement) {
    const { selectionStart, selectionEnd, value } = active;
    if (selectionStart !== null && selectionEnd !== null && selectionStart !== selectionEnd) {
      return value.slice(selectionStart, selectionEnd);
    }
  }
  return window.getSelection()?.toString() ?? '';
}
