/** What a person may send to stop alerts, compared after lower-casing and dropping punctuation. */
const STOP_WORDS: ReadonlySet<string> = new Set([
  'stop',
  'stop all',
  'unsubscribe',
  'band',
  'band karo',
  'band karein',
  'बंद',
  'बंद करो',
  'बंद करें',
  'बन्द',
  'बन्द करो',
  'बन्द करें',
  'रोको',
  'रोकें',
  'स्टॉप',
]);

export function isStopRequest(text: string): boolean {
  const normalized = text
    .normalize('NFC')
    .toLowerCase()
    .replace(/[.!?,;:।"'`~*_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return STOP_WORDS.has(normalized);
}
