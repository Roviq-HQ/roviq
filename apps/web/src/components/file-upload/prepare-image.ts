import { IMAGE_UPLOAD_MAX_PX } from '@roviq/common-types';

/** Part of the source image to keep, in source pixels. */
export interface CropArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

const QUALITY = 0.85;

function toBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, QUALITY));
}

/**
 * Crops and scales an image down in the browser, so a 50 MB phone photo leaves the device as a
 * few hundred KB. Returns the original file when the browser cannot decode it or nothing would
 * be gained; the server normalises every image again, so this is only about upload size.
 */
export async function prepareImage(file: File, crop?: CropArea): Promise<File> {
  if (typeof createImageBitmap !== 'function') return file;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return file;
  }
  try {
    const source = crop ?? { x: 0, y: 0, width: bitmap.width, height: bitmap.height };
    const scale = Math.min(1, IMAGE_UPLOAD_MAX_PX / Math.max(source.width, source.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(source.width * scale));
    canvas.height = Math.max(1, Math.round(source.height * scale));
    const context = canvas.getContext('2d');
    if (!context) return file;
    context.drawImage(
      bitmap,
      source.x,
      source.y,
      source.width,
      source.height,
      0,
      0,
      canvas.width,
      canvas.height,
    );

    // Browsers that cannot encode WebP silently return PNG; ask for JPEG then.
    let blob = await toBlob(canvas, 'image/webp');
    if (blob?.type !== 'image/webp') blob = await toBlob(canvas, 'image/jpeg');
    if (!blob) return file;
    // Without a crop, re-encoding is only worth it when the result is smaller.
    if (!crop && blob.size >= file.size) return file;

    const extension = blob.type === 'image/webp' ? 'webp' : 'jpg';
    const name = `${file.name.replace(/\.[^.]*$/, '')}.${extension}`;
    return new File([blob], name, { type: blob.type });
  } finally {
    bitmap.close();
  }
}
