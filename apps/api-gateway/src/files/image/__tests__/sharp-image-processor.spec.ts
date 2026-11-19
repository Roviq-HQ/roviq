import assert from 'node:assert';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { InvalidImageError } from '../image-processor';
import { MAX_INPUT_PIXELS, SharpImageProcessor } from '../sharp-image-processor';

const DOCUMENT = { square: false, fullPx: 2560, cacheableThumbnails: false };
const AVATAR = { square: true, fullPx: 1024, cacheableThumbnails: true };

/** A solid-colour JPEG, optionally carrying EXIF like a phone photo. */
function jpeg(
  width: number,
  height: number,
  exif?: { orientation?: number; gps?: boolean },
): Promise<Buffer> {
  let image = sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 40, b: 40 } },
  });
  // `withExif` cannot set Orientation; `withMetadata` writes the tag phones use.
  if (exif?.orientation) image = image.withMetadata({ orientation: exif.orientation });
  if (exif?.gps) {
    image = image.withExif({
      IFD0: { Make: 'TestPhone' },
      IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '28/1 36/1 50/1' },
    });
  }
  return image.jpeg().toBuffer();
}

function variant(result: Awaited<ReturnType<SharpImageProcessor['process']>>, name: string) {
  const found = result.variants.find((v) => v.name === name);
  assert(found, `variant ${name} missing`);
  return found;
}

describe('SharpImageProcessor', () => {
  const processor = new SharpImageProcessor();

  it('should produce SM, MD and FULL as WebP, keeping the shape of a document scan', async () => {
    const result = await processor.process(await jpeg(4000, 3000), DOCUMENT);

    expect(result.variants.map((v) => v.name).sort()).toEqual(['FULL', 'MD', 'SM']);
    expect([variant(result, 'SM').width, variant(result, 'SM').height]).toEqual([128, 96]);
    expect([variant(result, 'MD').width, variant(result, 'MD').height]).toEqual([512, 384]);
    expect([variant(result, 'FULL').width, variant(result, 'FULL').height]).toEqual([2560, 1920]);
    for (const v of result.variants) {
      expect((await sharp(v.data).metadata()).format).toBe('webp');
    }
  });

  it('should crop an avatar to a square in every size', async () => {
    const result = await processor.process(await jpeg(3000, 2000), AVATAR);

    expect([variant(result, 'SM').width, variant(result, 'SM').height]).toEqual([128, 128]);
    expect([variant(result, 'FULL').width, variant(result, 'FULL').height]).toEqual([1024, 1024]);
  });

  it('should cut a small avatar to a square of its short side, never a rectangle', async () => {
    const result = await processor.process(await jpeg(1500, 1000), AVATAR);

    expect([variant(result, 'FULL').width, variant(result, 'FULL').height]).toEqual([1000, 1000]);
    expect([variant(result, 'MD').width, variant(result, 'MD').height]).toEqual([512, 512]);
  });

  it('should keep a tiny avatar square without enlarging it', async () => {
    const result = await processor.process(await jpeg(90, 60), AVATAR);

    for (const name of ['SM', 'MD', 'FULL']) {
      expect([variant(result, name).width, variant(result, name).height]).toEqual([60, 60]);
    }
  });

  it('should cut a sideways avatar photo square after turning it upright', async () => {
    const result = await processor.process(await jpeg(900, 600, { orientation: 6 }), AVATAR);

    expect([variant(result, 'FULL').width, variant(result, 'FULL').height]).toEqual([600, 600]);
  });

  it('should never enlarge an image smaller than the target size', async () => {
    const result = await processor.process(await jpeg(300, 200), DOCUMENT);

    expect([variant(result, 'FULL').width, variant(result, 'FULL').height]).toEqual([300, 200]);
    expect([variant(result, 'MD').width, variant(result, 'MD').height]).toEqual([300, 200]);
    expect(variant(result, 'SM').width).toBe(128);
  });

  it('should turn a photo taken sideways upright', async () => {
    // Orientation 6: stored 400x200, meant to be shown rotated to 200x400.
    const sideways = await jpeg(400, 200, { orientation: 6 });

    const result = await processor.process(sideways, DOCUMENT);

    expect([variant(result, 'FULL').width, variant(result, 'FULL').height]).toEqual([200, 400]);
  });

  it('should remove EXIF, including GPS location, from every size', async () => {
    const withLocation = await jpeg(800, 600, { gps: true });
    expect((await sharp(withLocation).metadata()).exif).toBeDefined();

    const result = await processor.process(withLocation, DOCUMENT);

    for (const v of result.variants) {
      expect((await sharp(v.data).metadata()).exif).toBeUndefined();
    }
  });

  it('should drop bytes appended after the image data', async () => {
    const payload = Buffer.from('<script>alert(1)</script>');
    const polyglot = Buffer.concat([await jpeg(600, 400), payload]);

    const result = await processor.process(polyglot, DOCUMENT);

    for (const v of result.variants) {
      expect(v.data.includes(payload)).toBe(false);
    }
  });

  it('should return a small blurred placeholder as a WebP data URI', async () => {
    const result = await processor.process(await jpeg(1200, 800), DOCUMENT);

    expect(result.placeholder.startsWith('data:image/webp;base64,')).toBe(true);
    expect(result.placeholder.length).toBeLessThan(1000);
  });

  it('should refuse bytes that are not an image', async () => {
    await expect(
      processor.process(Buffer.from('%PDF-1.7 not an image'), DOCUMENT),
    ).rejects.toBeInstanceOf(InvalidImageError);
  });

  it('should refuse an SVG even though the image library can read one', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>');

    await expect(processor.process(svg, DOCUMENT)).rejects.toBeInstanceOf(InvalidImageError);
  });

  it('should refuse a truncated image', async () => {
    const whole = await jpeg(800, 600);

    await expect(
      processor.process(whole.subarray(0, Math.floor(whole.length / 2)), DOCUMENT),
    ).rejects.toBeInstanceOf(InvalidImageError);
  });

  it('should refuse an image with more pixels than the limit', async () => {
    // A tiny file that declares huge dimensions: a solid PNG compresses to almost nothing.
    const side = Math.ceil(Math.sqrt(MAX_INPUT_PIXELS)) + 10;
    const bomb = await sharp({
      create: { width: side, height: side, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .png({ compressionLevel: 9 })
      .toBuffer();

    await expect(processor.process(bomb, DOCUMENT)).rejects.toBeInstanceOf(InvalidImageError);
  }, 60_000);

  it('should finish every image when more arrive than may run at once', async () => {
    const input = await jpeg(600, 400);

    const results = await Promise.all(
      Array.from({ length: 6 }, () => processor.process(input, DOCUMENT)),
    );

    expect(results).toHaveLength(6);
    expect(results.every((r) => r.variants.length === 3)).toBe(true);
  });
});
