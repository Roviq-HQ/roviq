import { describe, expect, it } from 'vitest';
import { escapeLikePattern } from '../i18n';

describe('escapeLikePattern', () => {
  it('preserves literal search characters', () => {
    expect(escapeLikePattern('100%_test')).toBe('100\\%\\_test');
    expect(escapeLikePattern('அறிவியல்')).toBe('அறிவியல்');
  });
});
