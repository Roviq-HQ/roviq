import { describe, expect, it } from 'vitest';
import { keyedLineItems } from '../keyed-line-items';

describe('keyedLineItems', () => {
  it('should give identical lines different keys', () => {
    const line = { description: 'Pro Plan', quantity: 1, unitAmountPaise: '99900' };

    const keys = keyedLineItems([line, { ...line }, { ...line, quantity: 2 }]).map((k) => k.key);

    expect(keys).toEqual(['Pro Plan|1|99900#0', 'Pro Plan|1|99900#1', 'Pro Plan|2|99900#0']);
  });
});
