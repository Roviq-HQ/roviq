import { describe, expect, it } from 'vitest';
import { mergeMessages } from '../merge-messages';

describe('mergeMessages', () => {
  it('should retain missing English keys inside translated namespaces', () => {
    expect(
      mergeMessages(
        {
          account: { title: 'Account', language: { title: 'Language', saved: 'Saved' } },
          common: { cancel: 'Cancel' },
        },
        { account: { title: 'खाता', language: { title: 'भाषा' } } },
      ),
    ).toEqual({
      account: { title: 'खाता', language: { title: 'भाषा', saved: 'Saved' } },
      common: { cancel: 'Cancel' },
    });
  });
  it('should preserve the original dictionaries', () => {
    const fallback = { account: { title: 'Account', description: 'Settings' } };
    const translated = { account: { title: 'खाता' } };
    mergeMessages(fallback, translated);
    expect(fallback).toEqual({ account: { title: 'Account', description: 'Settings' } });
    expect(translated).toEqual({ account: { title: 'खाता' } });
  });
});
