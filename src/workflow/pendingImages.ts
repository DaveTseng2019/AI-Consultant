import type { AIProvider } from '../../shared/types';

/**
 * Images the user attached to the question this run is answering. Module state, like the turn
 * reservations and the in-flight set next to it: the images belong to the run, not to one step,
 * and threading them through every prepare/run/step signature would touch four layers to say
 * something that is true of the whole run.
 *
 * Each provider receives them once. A later step in the same run is a follow-up to a page that
 * already holds the image, and re-uploading it there would attach it twice.
 */
let runImages: string[] = [];
const deliveredTo = new Set<AIProvider>();

export function setRunImages(images: readonly string[]): void {
  runImages = [...images];
  deliveredTo.clear();
}

export function clearRunImages(): void {
  runImages = [];
  deliveredTo.clear();
}

export function takeRunImagesFor(provider: AIProvider): string[] {
  if (runImages.length === 0 || deliveredTo.has(provider)) return [];
  deliveredTo.add(provider);
  return [...runImages];
}
