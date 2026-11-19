import type { ImageStoragePolicy, ImageVariant } from '@roviq/common-types';

export interface ProcessedVariant {
  name: ImageVariant;
  data: Buffer;
  width: number;
  height: number;
}

export interface ProcessedImage {
  /** SM, MD and FULL, all WebP with no metadata. */
  variants: ProcessedVariant[];
  /** Tiny blurred preview as a `data:` URI. */
  placeholder: string;
}

/** The bytes are not a JPEG, PNG or WebP image, are damaged, or exceed the pixel limit. */
export class InvalidImageError extends Error {}

/** Behind an interface so processing can move to a separate worker without touching callers. */
export abstract class ImageProcessor {
  abstract process(input: Buffer, policy: ImageStoragePolicy): Promise<ProcessedImage>;
}
