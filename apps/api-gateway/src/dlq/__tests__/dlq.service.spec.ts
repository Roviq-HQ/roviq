import { describe, expect, it } from 'vitest';
import { DlqService } from '../dlq.service';

// `buildReplayPublish` is static + pure — the JetStreamServer envelope and
// restored NATS headers are the contract the DLQ reader replays on, so test
// the shape directly without booting the service.
describe('DlqService.buildReplayPublish', () => {
  it('publishes on the original subject with a {pattern,data} envelope', () => {
    const pub = DlqService.buildReplayPublish({
      originalSubject: 'NOTIFICATION.user.created',
      payload: { userId: 'u-1', email: 'a@b.com' },
      correlationId: 'corr-123',
      tenantId: 'tenant-9',
    });

    expect(pub.subject).toBe('NOTIFICATION.user.created');
    expect(JSON.parse(pub.data)).toEqual({
      pattern: 'NOTIFICATION.user.created',
      data: { userId: 'u-1', email: 'a@b.com' },
    });
  });

  it('restores correlation-id and tenant-id headers', () => {
    const pub = DlqService.buildReplayPublish({
      originalSubject: 'STUDENT.updated',
      payload: { id: 's-1' },
      correlationId: 'corr-xyz',
      tenantId: 'tenant-7',
    });

    expect(pub.headers).toEqual({
      'correlation-id': 'corr-xyz',
      'tenant-id': 'tenant-7',
    });
  });

  it('maps a null tenantId to an empty tenant-id header', () => {
    const pub = DlqService.buildReplayPublish({
      originalSubject: 'STUDENT.updated',
      payload: { id: 's-1' },
      correlationId: 'corr-xyz',
      tenantId: null,
    });

    expect(pub.headers['tenant-id']).toBe('');
  });
});
