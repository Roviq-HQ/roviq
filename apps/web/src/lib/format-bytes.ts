type NumberFormatter = (value: number, options?: Intl.NumberFormatOptions) => string;

const UNITS = [
  { unit: 'gigabyte', bytes: 1024 ** 3 },
  { unit: 'megabyte', bytes: 1024 ** 2 },
  { unit: 'kilobyte', bytes: 1024 },
] as const;

/** Storage size in the largest unit that keeps the number at 1 or more, e.g. "1.2 GB". */
export function formatBytes(bytes: number, format: NumberFormatter): string {
  const fit = UNITS.find((u) => bytes >= u.bytes) ?? UNITS[2];
  return format(bytes / fit.bytes, {
    style: 'unit',
    unit: fit.unit,
    maximumFractionDigits: 1,
  });
}
