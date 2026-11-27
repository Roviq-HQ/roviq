import { describe, expect, it } from 'vitest';
import { FOREIGN_SCOPE_WINDOW_MS, ResponseScopeGauge } from '../response-scope-gauge';

const reading = (gauge: ResponseScopeGauge, now: number) =>
  Object.fromEntries(gauge.readings(now).map((r) => [`${r.scope}/${r.reason}`, r.count]));

describe('ResponseScopeGauge', () => {
  it('should report 0 for every scope and reason before anything happened', () => {
    expect(reading(new ResponseScopeGauge(), 1_000)).toEqual({
      'institute/foreign_id': 0,
      'institute/too_large': 0,
      'reseller/foreign_id': 0,
      'reseller/too_large': 0,
    });
  });

  it('should count an event at once, under its reason, and drop it when it leaves the window', () => {
    const gauge = new ResponseScopeGauge();
    gauge.record('institute', 'foreign_id', 1_000);
    gauge.record('institute', 'too_large', 2_000);
    gauge.record('reseller', 'foreign_id', 2_000);

    expect(reading(gauge, 3_000)).toEqual({
      'institute/foreign_id': 1,
      'institute/too_large': 1,
      'reseller/foreign_id': 1,
      'reseller/too_large': 0,
    });
    expect(reading(gauge, 1_500 + FOREIGN_SCOPE_WINDOW_MS)).toEqual({
      'institute/foreign_id': 0,
      'institute/too_large': 1,
      'reseller/foreign_id': 1,
      'reseller/too_large': 0,
    });
    expect(reading(gauge, 2_000 + FOREIGN_SCOPE_WINDOW_MS)).toEqual({
      'institute/foreign_id': 0,
      'institute/too_large': 0,
      'reseller/foreign_id': 0,
      'reseller/too_large': 0,
    });
  });
});
