import { describe, expect, it, vi } from 'vitest';
import { DigestBuffer, runDigestLoop } from '../digest-logic';

const CLOSE = '2026-04-10T12:30:00.000Z';
const LATER = '2026-04-11T12:30:00.000Z';

describe('DigestBuffer', () => {
  it('should collect a redelivered item once', () => {
    const buffer = new DigestBuffer<string>();

    buffer.add({ dedupeKey: 'NOTIFICATION:7:ATTENDANCE_ABSENT:u1', runAt: CLOSE, value: 'first' });
    buffer.add({ dedupeKey: 'NOTIFICATION:7:ATTENDANCE_ABSENT:u1', runAt: CLOSE, value: 'again' });

    expect(buffer.drain()).toEqual(['first']);
    expect(buffer.drain()).toEqual([]);
  });

  it('should report the earliest window close among pending items', () => {
    const buffer = new DigestBuffer<string>();
    buffer.add({ dedupeKey: 'b', runAt: LATER, value: 'b' });
    buffer.add({ dedupeKey: 'a', runAt: CLOSE, value: 'a' });

    expect(buffer.pendingRunAt()).toBe(Date.parse(CLOSE));
    buffer.drain();
    expect(buffer.pendingRunAt()).toBeNull();
  });
});

describe('runDigestLoop', () => {
  it('should send two absences in one window as one summary', async () => {
    const buffer = new DigestBuffer<string>();
    buffer.add({ dedupeKey: 'NOTIFICATION:7:ATTENDANCE_ABSENT:u1', runAt: CLOSE, value: 'absent' });
    buffer.add({ dedupeKey: 'NOTIFICATION:8:ATTENDANCE_ABSENT:u1', runAt: CLOSE, value: 'late' });
    const send = vi.fn().mockResolvedValue(undefined);
    const sleepUntil = vi.fn().mockResolvedValue(undefined);

    const sent = await runDigestLoop({ firstRunAt: Date.parse(CLOSE), buffer, sleepUntil, send });

    expect(sent).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(['absent', 'late']);
    expect(sleepUntil).toHaveBeenCalledWith(Date.parse(CLOSE));
  });

  it('should send an item signalled during a send in a second summary', async () => {
    const buffer = new DigestBuffer<string>();
    buffer.add({ dedupeKey: 'k1', runAt: CLOSE, value: 'first' });
    const send = vi.fn().mockImplementationOnce(async () => {
      buffer.add({ dedupeKey: 'k2', runAt: LATER, value: 'second' });
    });
    const sleepUntil = vi.fn().mockResolvedValue(undefined);

    const sent = await runDigestLoop({ firstRunAt: Date.parse(CLOSE), buffer, sleepUntil, send });

    expect(sent).toBe(2);
    expect(send).toHaveBeenNthCalledWith(1, ['first']);
    expect(send).toHaveBeenNthCalledWith(2, ['second']);
    expect(sleepUntil).toHaveBeenNthCalledWith(2, Date.parse(LATER));
  });

  it('should send nothing when the window closes empty', async () => {
    const send = vi.fn();

    const sent = await runDigestLoop({
      firstRunAt: Date.parse(CLOSE),
      buffer: new DigestBuffer<string>(),
      sleepUntil: vi.fn().mockResolvedValue(undefined),
      send,
    });

    expect(sent).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });
});
