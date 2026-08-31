import { DEFAULT_DOCK_CONSTRAINTS, clamp } from './dockLayout';

export const DEFAULT_FOCUS_PANE_WIDTH = 560;

/** The conversation history rail. Its own width, so widening it eats the stage beside it, not the
 *  transcript column. w-48 was the fixed value it replaces. */
export const DEFAULT_SIDEBAR_WIDTH = 192;
export const MIN_SIDEBAR_WIDTH = 160;
export const MAX_SIDEBAR_WIDTH = 400;

export function clampSidebarWidth(width: number, containerWidth = Infinity): number {
  // Never so wide that the stage beside it has nothing left; 240px is a readable stage floor.
  const max = Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, containerWidth - 240));
  return clamp(Math.round(width), MIN_SIDEBAR_WIDTH, max);
}

export const DEFAULT_FOCUS_LAYOUT_CONSTRAINTS = {
  minFocusPaneWidth: 420,
  minCenterWidth: DEFAULT_DOCK_CONSTRAINTS.minCenterWidth,
  resizerWidth: DEFAULT_DOCK_CONSTRAINTS.resizerWidth,
};

export function clampFocusPaneWidth(
  width: number,
  containerWidth: number,
  constraints = DEFAULT_FOCUS_LAYOUT_CONSTRAINTS,
): number {
  const maxWidth = Math.max(
    constraints.minFocusPaneWidth,
    containerWidth - constraints.minCenterWidth - constraints.resizerWidth,
  );
  return clamp(Math.round(width), constraints.minFocusPaneWidth, maxWidth);
}

export function focusGridTemplateColumns(
  focusPaneWidth: number,
  constraints = DEFAULT_FOCUS_LAYOUT_CONSTRAINTS,
): string {
  return `${Math.round(focusPaneWidth)}px ${constraints.resizerWidth}px minmax(${constraints.minCenterWidth}px, 1fr)`;
}

export function dragFocusPaneWidth(startWidth: number, pointerDelta: number, minWidth: number, maxWidth: number): number {
  return clamp(Math.round(startWidth + pointerDelta), minWidth, maxWidth);
}

export function nonEmptyRect(rect: DOMRectReadOnly | null | undefined): DOMRectReadOnly | undefined {
  if (!rect || rect.width <= 0 || rect.height <= 0) return undefined;
  return rect;
}

export type CenterStagePresentationState = 'chip' | 'side' | 'center';
export type CenterStageWebviewState = 'none' | 'creating' | 'loaded';

export function throttleWithFrame(fn: () => void, scheduleFrame?: (cb: () => void) => number): () => void {
  let scheduled = false;
  return () => {
    if (scheduled) return;
    scheduled = true;
    // Resolved lazily (only once the returned handler actually fires) so constructing
    // this wrapper during SSR/tests, where requestAnimationFrame is undefined, is safe.
    const schedule = scheduleFrame ?? requestAnimationFrame;
    schedule(() => {
      scheduled = false;
      fn();
    });
  };
}

export async function driveCenteredProviderToStage<TProvider extends string>({
  provider,
  presentation,
  webview,
  bounds,
  setBounds,
}: {
  provider: TProvider;
  presentation: CenterStagePresentationState;
  webview: CenterStageWebviewState;
  bounds: DOMRectReadOnly | null | undefined;
  setBounds: (provider: TProvider, bounds: DOMRectReadOnly) => Promise<unknown>;
}): Promise<void> {
  const rect = nonEmptyRect(bounds);
  if (presentation !== 'center' || webview !== 'loaded' || !rect) return;
  await setBounds(provider, rect);
}
