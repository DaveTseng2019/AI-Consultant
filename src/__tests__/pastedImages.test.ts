import { describe, expect, it } from 'vitest';
import { clearRunImages, setRunImages, takeRunImagesFor } from '../workflow/pendingImages';
import { acceptPastedImages, imagesFromClipboard, MAX_PASTED_IMAGE_BYTES } from '../ui/pastedImages';

function imageFile(name: string, size = 1024, type = 'image/png') {
  return { name, size, type };
}

function clipboard(files: ReturnType<typeof imageFile>[], kinds: string[] = files.map(() => 'file')) {
  return {
    items: files.map((file, index) => ({ kind: kinds[index], type: file.type, getAsFile: () => file })),
  };
}

describe('clipboard images', () => {
  it('takes image files off the clipboard and leaves everything else', () => {
    const png = imageFile('shot.png');
    const text = { name: 'note.txt', size: 10, type: 'text/plain' };
    const data = clipboard([png, text]);

    expect(imagesFromClipboard(data)).toEqual([png]);
  });

  // A pasted screenshot is a file item; a selection copied from a page is a string item that
  // reports an image type. Treating the second as a file yields a null and would crash the read.
  it('ignores clipboard entries that are not files', () => {
    const png = imageFile('shot.png');
    expect(imagesFromClipboard(clipboard([png], ['string']))).toEqual([]);
  });

  it('refuses an oversized image and says so rather than silently dropping it', () => {
    const huge = imageFile('huge.png', MAX_PASTED_IMAGE_BYTES + 1);
    const result = acceptPastedImages([], [huge]);

    expect(result.accepted).toEqual([]);
    expect(result.error).toBeTruthy();
  });

  it('fills the remaining slots and reports the ones it could not take', () => {
    const current = [1, 2, 3].map((index) => ({
      id: `image-${index}`,
      name: `${index}.png`,
      type: 'image/png',
      size: 10,
      dataUrl: 'data:image/png;base64,AA==',
    }));
    const result = acceptPastedImages(current, [imageFile('a.png'), imageFile('b.png')]);

    expect(result.accepted.map((file) => file.name)).toEqual(['a.png']);
    expect(result.error).toBeTruthy();
  });
});

describe('images attached to a run', () => {
  // The point of the module: the first send to each provider carries the image, and a follow-up
  // step in the same run does not upload it a second time to a page that already holds it.
  it('hands the images to each provider once, then to nobody', () => {
    setRunImages(['data:image/png;base64,AA==']);

    expect(takeRunImagesFor('grok')).toEqual(['data:image/png;base64,AA==']);
    expect(takeRunImagesFor('chatgpt')).toEqual(['data:image/png;base64,AA==']);
    expect(takeRunImagesFor('grok')).toEqual([]);

    clearRunImages();
    expect(takeRunImagesFor('chatgpt')).toEqual([]);
  });

  it('carries nothing when the question had no image', () => {
    setRunImages([]);
    expect(takeRunImagesFor('grok')).toEqual([]);
  });
});
