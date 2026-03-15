'use client';

import { useEffect, useState } from 'react';

/**
 * Returns whether the given CSS media query currently matches.
 * Useful for responsive decisions — e.g. sheet vs dialog on mobile.
 * Returns `false` during SSR and on the initial render to avoid hydration mismatches.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const mediaQueryList = window.matchMedia(query);
    setMatches(mediaQueryList.matches);

    const listener = (event: MediaQueryListEvent) => setMatches(event.matches);
    mediaQueryList.addEventListener('change', listener);
    return () => mediaQueryList.removeEventListener('change', listener);
  }, [query]);

  return matches;
}
