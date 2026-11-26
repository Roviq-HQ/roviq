import { describe, expect, it } from 'vitest';
import { FOREIGN_SCOPE_WINDOW_MS, ResponseScopeGauge } from '../response-scope-gauge';

describe('ResponseScopeGauge', () => {
  it('should report 0 for both scopes before anything happened', () => {
    expect(new ResponseScopeGauge().readings(1_000)).toEqual([
      { scope: 'institute', count: 0 },
      { scope: 'reseller', count: 0 },
    ]);
  });

  it('should count an event at once and drop it when it leaves the window', () => {
    const gauge = new ResponseScopeGauge();
    gauge.record('institute', 1_000);
    gauge.record('institute', 2_000);
    gauge.record('reseller', 2_000);

    expect(gauge.readings(3_000)).toEqual([
      { scope: 'institute', count: 2 },
      { scope: 'reseller', count: 1 },
    ]);
    expect(gauge.readings(1_500 + FOREIGN_SCOPE_WINDOW_MS)).toEqual([
      { scope: 'institute', count: 1 },
      { scope: 'reseller', count: 1 },
    ]);
    expect(gauge.readings(2_000 + FOREIGN_SCOPE_WINDOW_MS)).toEqual([
      { scope: 'institute', count: 0 },
      { scope: 'reseller', count: 0 },
    ]);
  });
});
