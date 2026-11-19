import { Injectable } from '@nestjs/common';
import { IMAGE_VARIANT_PX, type ImageStoragePolicy, type ImageVariant } from '@roviq/common-types';
import sharp from 'sharp';
import {
  ImageProcessor,
  InvalidImageError,
  type ProcessedImage,
  type ProcessedVariant,
} from './image-processor';

/** A decoded image needs memory in proportion to its pixels, however small the file is. */
export const MAX_INPUT_PIXELS = 120_000_000;
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

    const sizes: Array<[ImageVariant, number]> = [
      ['SM', IMAGE_VARIANT_PX.SM],
      ['MD', IMAGE_VARIANT_PX.MD],
      ['FULL', policy.fullPx],
    ];
    const variants: ProcessedVariant[] = [];
    for (const [name, px] of sizes) {
      // Re-encoding drops EXIF (including GPS) and anything appended to the image data.
      const { data, info } = await this.open(input)
        .resize(px, px, { fit: policy.square ? 'cover' : 'inside', withoutEnlargement: true })
        .webp({ quality: WEBP_QUALITY })
        .toBuffer({ resolveWithObject: true });
      variants.push({ name, data, width: info.width, height: info.height });
    }

    const preview = await this.open(input)
      .resize(PLACEHOLDER_PX, PLACEHOLDER_PX, { fit: policy.square ? 'cover' : 'inside' })
      .blur(1)
      .webp({ quality: 40 })
      .toBuffer();
    return { variants, placeholder: `data:image/webp;base64,${preview.toString('base64')}` };
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
