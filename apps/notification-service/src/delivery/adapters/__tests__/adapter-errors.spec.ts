import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ADAPTER_ERROR_KINDS,
  type AdapterErrorCode,
  failureKindOf,
  isTableCode,
} from '../adapter-errors';
import { ChannelAdapterError } from '../channel-adapter';

const SRC = join(__dirname, '..', '..', '..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sourceFiles(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts') ? [path] : [];
  });
}

/** Every error code literal the service's adapters, clients and sender can produce. */
function codesInSource(): Map<string, string> {
  const found = new Map<string, string>();
  const patterns = [
    /ChannelAdapterError\(\s*'([A-Z][A-Z0-9_]*)'/g,
    /\bcode: '([A-Z][A-Z0-9_]*)'/g,
    /'((?:SMS|WA|FCM|SMTP)_[A-Z0-9_]+|NO_RECIPIENT)'/g,
  ];
  for (const file of sourceFiles(SRC)) {
    const name = relative(SRC, file);
    // The table itself, and settings whose names share the prefixes.
    if (name.endsWith('adapter-errors.ts') || name.startsWith('config/')) continue;
    const text = readFileSync(file, 'utf8');
    for (const pattern of patterns) {
      for (const match of text.matchAll(pattern)) {
        const code = match[1];
        if (code !== undefined && !/_(API|BASE|KEY|URL|ID|IDS|SECRET|FROM|JSON)\b/.test(code)) {
          found.set(code, name);
        }
      }
    }
  }
  return found;
}

describe('adapter error classification', () => {
  it('should classify every error code used in the service source', () => {
    const found = codesInSource();

    // Proves the scan reads the adapters and clients at all.
    for (const code of ['NO_RECIPIENT', 'SMS_UNREACHABLE', 'WA_SENDER_BLOCKED', 'FCM_AUTH']) {
      expect(found.has(code)).toBe(true);
    }
    const unclassified = [...found].filter(([code]) => !isTableCode(code));
    expect(unclassified).toEqual([]);
  });

  it.each([
    'SMS_SENDER_BLOCKED',
    'SMS_RATE_LIMITED',
    'SMS_UNREACHABLE',
    'WA_SENDER_BLOCKED',
    'WA_RATE_LIMITED',
    'WA_UNREACHABLE',
    'FCM_AUTH',
    'FCM_UNREACHABLE',
    'QUOTA_EXCEEDED',
    'ECONNECTION',
    'ETIMEDOUT',
    'EAUTH_535',
  ] as const satisfies readonly AdapterErrorCode[])('should mark %s as the provider being unavailable', (code) => {
    expect(failureKindOf(code)).toBe('provider_unavailable');
  });

  it.each([
    'NO_RECIPIENT',
    'SMS_TEMPLATE_REJECTED',
    'SMS_INVALID_NUMBER',
    'SMS_VARIABLE_TOO_LONG',
    'SMS_REJECTED',
    'WA_TEMPLATE_REJECTED',
    'WA_NOT_ON_WHATSAPP',
    'WA_REJECTED',
    'UNREGISTERED',
    'INVALID_ARGUMENT',
    'EENVELOPE_550',
    'SMTP_ERROR',
  ] as const satisfies readonly AdapterErrorCode[])('should mark %s as a refusal of the message', (code) => {
    expect(failureKindOf(code)).toBe('message_refused');
  });

  it('should give every code in the table one of the two kinds', () => {
    const kinds = new Set(Object.values(ADAPTER_ERROR_KINDS));

    expect([...kinds].sort()).toEqual(['message_refused', 'provider_unavailable']);
  });

  it('should carry the kind on the error', () => {
    expect(new ChannelAdapterError('WA_SENDER_BLOCKED', 'provider code 368', false).kind).toBe(
      'provider_unavailable',
    );
    expect(new ChannelAdapterError('WA_NOT_ON_WHATSAPP', 'provider code 131026', false).kind).toBe(
      'message_refused',
    );
  });
});
