import { describe, expect, it } from 'vitest';
import { toDlqRow } from '../dlq.consumer';

describe('toDlqRow', () => {
  it('maps a DlqMessage + stream seq to a dlq_messages row', () => {
    const row = toDlqRow(
      {
        originalSubject: 'NOTIFICATION.user.created',
        payload: { userId: 'u1' },
        error: 'Novu 503',
        retryCount: 5,
        correlationId: 'corr-1',
        tenantId: 't1',
        failedAt: '2026-05-27T00:00:00.000Z',
      },
      42n,
    );
    expect(row).toEqual({
      dlqStreamSeq: 42n,
      originalSubject: 'NOTIFICATION.user.created',
      originStream: 'NOTIFICATION',
      payload: { userId: 'u1' },
      error: 'Novu 503',
      retryCount: 5,
      correlationId: 'corr-1',
      tenantId: 't1',
      failedAt: '2026-05-27T00:00:00.000Z',
    });
  });

  it('defaults tenantId to null and derives originStream when tenantId absent', () => {
    const row = toDlqRow(
      {
        originalSubject: 'AUDIT.log',
        payload: null,
        error: 'x',
        retryCount: 3,
        correlationId: 'c',
        failedAt: '2026-05-27T00:00:00.000Z',
      },
      7n,
    );
    expect(row.tenantId).toBeNull();
    expect(row.originStream).toBe('AUDIT');
  });
});
