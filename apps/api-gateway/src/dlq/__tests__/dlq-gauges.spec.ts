import { describe, expect, it } from 'vitest';
import { dlqRecentReadings } from '../dlq-gauges';

describe('dlqRecentReadings', () => {
  it('should report a stream seen before as 0 once its rows leave the window', () => {
    const seen = new Set<string>();

    expect(dlqRecentReadings([{ originStream: 'NOTIFICATION', count: 1 }], seen)).toEqual([
      { originStream: 'NOTIFICATION', count: 1 },
    ]);
    expect(dlqRecentReadings([], seen)).toEqual([{ originStream: 'NOTIFICATION', count: 0 }]);
  });

  it('should report nothing for a stream never dead-lettered', () => {
    expect(dlqRecentReadings([], new Set())).toEqual([]);
  });
});
