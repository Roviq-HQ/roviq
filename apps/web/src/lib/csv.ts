/** RFC 4180 CSV text: every field quoted, embedded quotes doubled. */
export function buildCsv(
  headers: readonly string[],
  rows: readonly (readonly (string | number)[])[],
): string {
  const lines = [headers.map(csvEscape).join(',')];
  for (const row of rows) lines.push(row.map(csvEscape).join(','));
  // Leading BOM so Excel on Windows opens UTF-8 (Hindi) text correctly.
  return `﻿${lines.join('\n')}`;
}

export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

/**
 * A spreadsheet runs a text cell that starts with one of these as a formula. Names and notes are
 * typed by users, so such a cell gets a leading apostrophe and is shown as text.
 */
function neutraliseFormula(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function csvEscape(value: string | number): string {
  const text = typeof value === 'number' ? String(value) : neutraliseFormula(value);
  return `"${text.replace(/"/g, '""')}"`;
}
