'use client';

import { cn } from '@roviq/ui/lib/utils';
import * as React from 'react';

export interface StoredImageFile {
  /** Link for the size to show; request it with `url(variant: …)`. */
  url?: string | null;
  width?: number | null;
  height?: number | null;
  placeholder?: string | null;
}

export interface StoredImageProps {
  /** A `FileRef` of an image, or null when there is none. */
  file: StoredImageFile | null | undefined;
  alt: string;
  /** Shown when there is no image or it fails to load (initials for an avatar). */
  fallback?: React.ReactNode;
  className?: string;
  testId?: string;
}

/**
 * An image from file storage: the blurred preview shows at once, the box keeps the image's
 * shape so the page does not jump, and the picture fades in when it arrives.
 */
export function StoredImage({ file, alt, fallback = null, className, testId }: StoredImageProps) {
  const [failed, setFailed] = React.useState(false);
  const [loaded, setLoaded] = React.useState(false);
  const url = file?.url ?? null;

  // A new file must not inherit the previous one's state.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset is keyed on the link alone
  React.useEffect(() => {
    setFailed(false);
    setLoaded(false);
  }, [url]);

  if (!url || failed) return <>{fallback}</>;

  return (
    <span
      className={cn('relative block overflow-hidden bg-muted bg-cover bg-center', className)}
      style={{
        ...(file?.width && file.height ? { aspectRatio: `${file.width} / ${file.height}` } : {}),
        ...(file?.placeholder ? { backgroundImage: `url("${file.placeholder}")` } : {}),
      }}
      data-testid={testId}
    >
      {/* Not next/image: its optimiser would fetch the signed link server-side and break both
          the signature's lifetime and the browser cache this link is built for. */}
      {/* biome-ignore lint/performance/noImgElement: see above */}
      <img
        src={url}
        alt={alt}
        loading="lazy"
        decoding="async"
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
        className={cn(
          'size-full object-cover transition-opacity duration-200',
          loaded ? 'opacity-100' : 'opacity-0',
        )}
      />
    </span>
  );
}
