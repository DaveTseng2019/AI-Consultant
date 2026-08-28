import type { Locale } from '../i18n/resolve';
import { t } from '../i18n/t';

/**
 * An image the user pasted into the composer, held as a data URL because that is the only shape
 * that survives the trip into a provider page: the injected script cannot read a clipboard, and
 * provider_eval carries a string.
 *
 * Deliberately not an [[AttachmentChip]]. A text attachment is folded into the prompt and is
 * budgeted in characters; an image is handed to the provider's own uploader and is budgeted in
 * bytes. One type covering both would carry a field that is meaningless on either side.
 */
export interface PastedImage {
  id: string;
  name: string;
  type: string;
  size: number;
  dataUrl: string;
}

export const MAX_PASTED_IMAGES = 4;
// notes: the bytes ride into the page inside a provider_eval string, and base64 adds a third on
//        top. Raise it once the image travels as a real IPC payload rather than as script text.
export const MAX_PASTED_IMAGE_BYTES = 4 * 1024 * 1024;

export interface ImageFileLike {
  name: string;
  size: number;
  type: string;
}

interface ClipboardItemLike<TFile extends ImageFileLike> {
  kind: string;
  type: string;
  getAsFile(): TFile | null;
}

export interface ClipboardDataLike<TFile extends ImageFileLike> {
  items?: ArrayLike<ClipboardItemLike<TFile>> | null;
  files?: ArrayLike<TFile> | null;
}

export function isImageFile(file: ImageFileLike): boolean {
  return file.type.startsWith('image/');
}

/** Images on the clipboard. A screenshot arrives as an item with no name; a copied file has both. */
export function imagesFromClipboard<TFile extends ImageFileLike>(
  clipboardData: ClipboardDataLike<TFile> | null | undefined,
): TFile[] {
  if (!clipboardData) return [];
  const fromItems = Array.from(clipboardData.items ?? [])
    .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
    .map((item) => item.getAsFile())
    .filter((file): file is TFile => file !== null);
  if (fromItems.length > 0) return fromItems;
  return Array.from(clipboardData.files ?? []).filter(isImageFile);
}

export function acceptPastedImages<TFile extends ImageFileLike>(
  current: readonly PastedImage[],
  incoming: readonly TFile[],
  locale: Locale = 'en',
): { accepted: TFile[]; error?: string } {
  const slots = Math.max(0, MAX_PASTED_IMAGES - current.length);
  const withinSize = incoming.filter((file) => file.size <= MAX_PASTED_IMAGE_BYTES);
  const accepted = withinSize.slice(0, slots);

  if (withinSize.length < incoming.length) return { accepted, error: t('image.tooLarge', locale) };
  if (accepted.length < incoming.length) return { accepted, error: t('image.limit', locale) };
  return { accepted };
}

export function removePastedImage(images: readonly PastedImage[], id: string): PastedImage[] {
  return images.filter((image) => image.id !== id);
}

let nextPastedImageId = 0;

export function makePastedImageId(): string {
  nextPastedImageId += 1;
  return `image-${Date.now().toString(36)}-${nextPastedImageId.toString(36)}`;
}

export function pastedImageDataUrls(images: readonly PastedImage[]): string[] {
  return images.map((image) => image.dataUrl);
}

/** Read one clipboard image into the data URL the provider page will be handed. */
export function readPastedImage(file: File, createId: () => string = makePastedImageId): Promise<PastedImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('image read failed'));
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : '';
      if (!dataUrl.startsWith('data:image/')) {
        reject(new Error('clipboard item is not an image'));
        return;
      }
      resolve({
        id: createId(),
        // A screenshot arrives with no usable name; the provider only needs something to label it.
        name: file.name || 'pasted-image',
        type: file.type,
        size: file.size,
        dataUrl,
      });
    };
    reader.readAsDataURL(file);
  });
}
