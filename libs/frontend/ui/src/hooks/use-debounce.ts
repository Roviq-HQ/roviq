'use client';

import { useEffect, useState } from 'react';

/**
 * Debounces a value by the given delay.
 * Useful for search inputs in data tables to avoid firing a query on every keystroke.
 */
export function useDebounce<T>(value: T, delay = 300): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
}
