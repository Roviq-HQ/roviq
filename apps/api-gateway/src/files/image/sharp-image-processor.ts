import { Injectable } from '@nestjs/common';
import { IMAGE_VARIANT_PX, type ImageStoragePolicy } from '@roviq/common-types';
import sharp from 'sharp';
import {
  ImageProcessor,
  InvalidImageError,
  type ProcessedImage,
  type ProcessedVariant,
} from './image-processor';

/**
 * A decoded image needs memory in proportion to its pixels, however small the file is. 50 million
 * covers the largest sensors phones use by default; browsers shrink photos before upload anyway.
 */
export const MAX_INPUT_PIXELS = 50_000_000;
/** Images being processed at once; more would starve request handling of CPU. */
const MAX_CONCURRENT = 2;
const ACCEPTED_FORMATS: ReadonlySet<string> = new Set(['jpeg', 'png', 'webp']);
const WEBP_QUALITY = 80;
const PLACEHOLDER_PX = 16;

@Injectable()
export class SharpImageProcessor extends ImageProcessor {
  private running = 0;
  private readonly waiting: Array<() => void> = [];

  async process(input: Buffer, policy: ImageStoragePolicy): Promise<ProcessedImage> {
    await this.acquire();
    try {
      return await this.run(input, policy);
    } catch (err) {
      if (err instanceof InvalidImageError) throw err;
      // sharp reports unreadable, truncated and oversized input as plain Errors.
      throw new InvalidImageError(err instanceof Error ? err.message : String(err));
    } finally {
      this.release();
    }
  }

  private async run(input: Buffer, policy: ImageStoragePolicy): Promise<ProcessedImage> {
    // The declared type is not trusted: sharp also reads SVG, GIF and TIFF, which are not accepted.
    const { format } = await this.open(input).metadata();
    if (!format || !ACCEPTED_FORMATS.has(format)) {
      throw new InvalidImageError(`Unsupported image format: ${format ?? 'unknown'}`);
    }

    const fit = policy.square ? 'cover' : 'inside';
    // The upload is decoded once, for FULL. The smaller sizes are cut from that result, which
    // is at most a few megapixels, so their cost does not depend on what was uploaded.
    const full = await this.encode(this.open(input), policy.fullPx, fit);
    const variants: ProcessedVariant[] = [];
    for (const [name, px] of [
      ['SM', IMAGE_VARIANT_PX.SM],
      ['MD', IMAGE_VARIANT_PX.MD],
    ] as const) {
      variants.push({ name, ...(await this.encode(sharp(full.data), px, fit)) });
    }
    variants.push({ name: 'FULL', ...full });

    const preview = await sharp(full.data)
      .resize(PLACEHOLDER_PX, PLACEHOLDER_PX, { fit })
      .blur(1)
      .webp({ quality: 40 })
      .toBuffer();
    return { variants, placeholder: `data:image/webp;base64,${preview.toString('base64')}` };
  }

  // Re-encoding drops EXIF (including GPS) and anything appended to the image data.
  private async encode(
    image: sharp.Sharp,
    px: number,
    fit: 'cover' | 'inside',
  ): Promise<Omit<ProcessedVariant, 'name'>> {
    const { data, info } = await image
      .resize(px, px, { fit, withoutEnlargement: true })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height };
  }

  private open(input: Buffer): sharp.Sharp {
    return sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, autoOrient: true });
  }

  private acquire(): Promise<void> {
    if (this.running < MAX_CONCURRENT) {
      this.running += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.waiting.push(resolve));
  }

  private release(): void {
    const next = this.waiting.shift();
    // A waiter takes over the slot, so the count stays the same.
    if (next) next();
    else this.running -= 1;
  }
}
