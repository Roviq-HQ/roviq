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

/** What a person who stopped may send to get alerts again. */
const START_WORDS: ReadonlySet<string> = new Set([
  'start',
  'unstop',
  'resume',
  'subscribe',
  'shuru',
  'shuru karo',
  'shuru karein',
  'chalu',
  'chalu karo',
  'शुरू',
  'शुरू करो',
  'शुरू करें',
  'चालू',
  'चालू करो',
  'चालू करें',
  'स्टार्ट',
]);

function normalize(text: string): string {
  return text
    .normalize('NFC')
    .toLowerCase()
    .replace(/[.!?,;:।"'`~*_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isStopRequest(text: string): boolean {
  return STOP_WORDS.has(normalize(text));
}

export function isStartRequest(text: string): boolean {
  return START_WORDS.has(normalize(text));
}

export type InboundIntent = 'stop' | 'start' | 'other';

/** The whole message must be the word: a sentence that merely contains it is `other`. */
export function intentOf(text: string): InboundIntent {
  if (isStopRequest(text)) return 'stop';
  return isStartRequest(text) ? 'start' : 'other';
}
