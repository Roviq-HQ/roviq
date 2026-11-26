/**
 * Admission number prefix resolution (ROV-154).
 *
 * Uses institute_configs.admission_number_config to determine the prefix
 * based on the standard's numeric_order. Pre-primary classes (-3, -2, -1)
 * get prefixes like N-, L-, U-. From Class 2 onwards, no prefix by default.
 */
import type { AdmissionNumberConfig } from '../schema/tenant/institute-configs';

/**
 * Resolve the admission number prefix for a given standard.
 *
 * @param config - The institute's admission_number_config from institute_configs
 * @param numericOrder - The numeric_order of the standard being admitted into
 * @returns The prefix string (e.g., 'N-') or empty string if no prefix
 *
 * @example
 * // Nursery (numeric_order = -3) → 'N-'
 * resolveAdmissionPrefix(config, -3)
 *
 * // Class 1 (numeric_order = 1) → 'A-'
 * resolveAdmissionPrefix(config, 1)
 *
 * // Class 5 (numeric_order = 5, no_prefix_from_class = 2) → ''
 * resolveAdmissionPrefix(config, 5)
 */
export function resolveAdmissionPrefix(
  config: AdmissionNumberConfig,
  numericOrder: number,
): string {
  // If numeric_order >= no_prefix_from_class, no prefix
  if (numericOrder >= config.no_prefix_from_class) {
    return '';
  }

  // Look up the prefix by numeric_order key
  const prefix = config.prefixes[String(numericOrder)];
  return prefix ?? '';
}

/**
 * Resolve the year portion of the admission number format.
 *
 * @param config - The institute's admission_number_config
 * @param date - The reference date (defaults to current date)
 * @returns The year string (e.g., '2025' or '25-26')
 */
export function resolveAdmissionYear(config: AdmissionNumberConfig, date = new Date()): string {
  // Indian academic year: April–March
  const year = date.getMonth() >= 3 ? date.getFullYear() : date.getFullYear() - 1;

  if (config.year_format === 'YY-YY') {
    const short = year % 100;
    const next = (short + 1) % 100;
    return `${String(short).padStart(2, '0')}-${String(next).padStart(2, '0')}`;
  }

  // Default: YYYY
  return String(year);
}

/**
 * Each prefix is its own admission register series (e.g. `K-` for Nursery–Class 1,
 * unprefixed from Class 2), so counters never interleave between class bands.
 */
export function admissionSeriesName(prefix: string): string {
  return `adm_no:${prefix}`;
}

/** Pre-series shared counter; new series start after its value so old numbers can't repeat. */
export const LEGACY_ADMISSION_SEQUENCE = 'adm_no';

const VALUE_PLACEHOLDER = /\{value(?::0(\d+)d)?\}/g;

/** Fill `{prefix}`, `{year}` and `{value}` / `{value:0Nd}` in a sequence format template. */
export function formatSequenceValue(
  template: string,
  parts: { prefix: string; year: string; value: bigint },
): string {
  return template
    .replaceAll('{prefix}', parts.prefix)
    .replaceAll('{year}', parts.year)
    .replace(VALUE_PLACEHOLDER, (_match, width: string | undefined) =>
      parts.value.toString().padStart(width ? Number(width) : 0, '0'),
    );
}

const TEMPLATE_TOKEN = /\{prefix\}|\{year\}|\{value(?::0(\d+)d)?\}/g;

/** The largest value a `tenant_sequences` counter (PostgreSQL bigint) can hold. */
export const MAX_SEQUENCE_VALUE = 9_223_372_036_854_775_807n;

/**
 * A serial may be this many digits longer than the template's padding (an unpadded `{value}`
 * counts as 4). `{value:04d}` accepts up to 999,999: a hundred times the register the padding was
 * chosen for. A longer number is a typo or a different register, and raising a counter to it
 * would push every later number out of that range, or past the bigint limit, for good.
 */
const EXTRA_SERIAL_DIGITS = 2;
const UNPADDED_WIDTH = 4;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The serial inside `value` when it is exactly what the series would print for that serial, else
 * null. A number of another prefix, year or shape never matches, so it can never raise a counter;
 * neither can a serial longer than the padding allows (see `EXTRA_SERIAL_DIGITS`).
 */
export function parseSequenceValue(
  template: string,
  parts: { prefix: string; year: string },
  value: string,
): bigint | null {
  let pattern = '';
  let width: number | null = null;
  let last = 0;
  for (const match of template.matchAll(TEMPLATE_TOKEN)) {
    pattern += escapeRegExp(template.slice(last, match.index));
    if (match[0] === '{prefix}') pattern += escapeRegExp(parts.prefix);
    else if (match[0] === '{year}') pattern += escapeRegExp(parts.year);
    else {
      pattern += width === null ? '(\\d+)' : '\\1';
      width ??= match[1] ? Number(match[1]) : 0;
    }
    last = match.index + match[0].length;
  }
  pattern += escapeRegExp(template.slice(last));
  if (width === null) return null;

  const digits = new RegExp(`^${pattern}$`).exec(value)?.[1];
  if (digits === undefined) return null;
  if (digits.length > Math.max(width, UNPADDED_WIDTH) + EXTRA_SERIAL_DIGITS) return null;
  const serial = BigInt(digits);
  if (serial === 0n || serial > MAX_SEQUENCE_VALUE) return null;
  return formatSequenceValue(template, { ...parts, value: serial }) === value ? serial : null;
}

/**
 * The fixed text every number of the series starts with: the template up to its value, filled.
 * `{prefix}{year}/{value:04d}` with `N-` and 2026 gives `N-2026/`.
 */
export function sequenceLiteralPrefix(
  template: string,
  parts: { prefix: string; year: string },
): string {
  const valueAt = template.search(/\{value(?::0\d+d)?\}/);
  const head = valueAt === -1 ? template : template.slice(0, valueAt);
  return head.replaceAll('{prefix}', parts.prefix).replaceAll('{year}', parts.year);
}
