import { randomUUID } from 'node:crypto';
import { ResellerStatus } from '@roviq/common-types';
import type { TemporalClientService } from '@roviq/temporal';
import { createMock } from '@roviq/testing';
import { describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';
import { ResellerDeletionConsumer } from '../reseller-deletion.consumer';

function setUp() {
  const startWorkflowOnce = vi.fn<TemporalClientService['startWorkflowOnce']>();
  const consumer = new ResellerDeletionConsumer(
    createMock<TemporalClientService>({ startWorkflowOnce }),
  );
  return { consumer, startWorkflowOnce };
}

const DELETED_AT = '2026-11-26T07:30:03.000Z';

/** As JetStream delivers it: `deletedAt` serialised to an ISO string. */
const event = (newStatus: string, id = randomUUID()) => ({
  id,
  previousStatus: ResellerStatus.SUSPENDED,
  newStatus,
  deletedAt: newStatus === ResellerStatus.DELETED ? DELETED_AT : null,
  scope: 'platform',
});

describe('ResellerDeletionConsumer', () => {
  it('should start the cleanup workflow once, keyed by the reseller id and deletion time', async () => {
    const { consumer, startWorkflowOnce } = setUp();
    startWorkflowOnce.mockResolvedValue(true);
    const id = randomUUID();

    await consumer.onStatusChanged(event(ResellerStatus.DELETED, id));

    expect(startWorkflowOnce).toHaveBeenCalledTimes(1);
    expect(startWorkflowOnce).toHaveBeenCalledWith('resellerDeletionCleanupWorkflow', {
      taskQueue: 'billing-automation',
      workflowId: `reseller-deletion-cleanup-${id}-${Date.parse(DELETED_AT)}`,
      args: [id],
    });
  });

  it.each([
    ResellerStatus.SUSPENDED,
    ResellerStatus.ACTIVE,
  ])('should start nothing when the new status is %s', async (status) => {
    const { consumer, startWorkflowOnce } = setUp();

    await consumer.onStatusChanged(event(status));

    expect(startWorkflowOnce).not.toHaveBeenCalled();
  });

  it('should resolve when Temporal reports the workflow was already started', async () => {
    const { consumer, startWorkflowOnce } = setUp();
    startWorkflowOnce.mockResolvedValue(false);

    await expect(consumer.onStatusChanged(event(ResellerStatus.DELETED))).resolves.toBeUndefined();
  });

  it('should rethrow a failed start so the event is redelivered', async () => {
    const { consumer, startWorkflowOnce } = setUp();
    startWorkflowOnce.mockRejectedValue(new Error('Temporal unavailable'));

    await expect(consumer.onStatusChanged(event(ResellerStatus.DELETED))).rejects.toThrow(
      'Temporal unavailable',
    );
  });

  it('should give a later deletion of the same reseller id its own workflow id', async () => {
    const { consumer, startWorkflowOnce } = setUp();
    startWorkflowOnce.mockResolvedValue(true);
    const id = randomUUID();

    await consumer.onStatusChanged(event(ResellerStatus.DELETED, id));
    await consumer.onStatusChanged({
      ...event(ResellerStatus.DELETED, id),
      deletedAt: '2026-12-01T00:00:00.000Z',
    });

    const ids = startWorkflowOnce.mock.calls.map(([, options]) => options.workflowId);
    expect(ids).toEqual([
      `reseller-deletion-cleanup-${id}-${Date.parse(DELETED_AT)}`,
      `reseller-deletion-cleanup-${id}-${Date.parse('2026-12-01T00:00:00.000Z')}`,
    ]);
  });

  it('should refuse a DELETED event without deletedAt and start nothing', async () => {
    const { consumer, startWorkflowOnce } = setUp();

    await expect(
      consumer.onStatusChanged({ ...event(ResellerStatus.DELETED), deletedAt: null }),
    ).rejects.toBeInstanceOf(ZodError);
    expect(startWorkflowOnce).not.toHaveBeenCalled();
  });

  it.each([
    ['a number', Date.parse(DELETED_AT)],
    ['a boolean', true],
    ['a non-ISO string', '26/11/2026'],
  ])('should refuse deletedAt given as %s and start nothing', async (_label, deletedAt) => {
    const { consumer, startWorkflowOnce } = setUp();

    await expect(
      consumer.onStatusChanged({ ...event(ResellerStatus.DELETED), deletedAt }),
    ).rejects.toBeInstanceOf(ZodError);
    expect(startWorkflowOnce).not.toHaveBeenCalled();
  });

  it('should accept deletedAt as a Date, as the in-process emit passes it', async () => {
    const { consumer, startWorkflowOnce } = setUp();
    startWorkflowOnce.mockResolvedValue(true);
    const id = randomUUID();

    await consumer.onStatusChanged({
      ...event(ResellerStatus.DELETED, id),
      deletedAt: new Date(DELETED_AT),
    });

    expect(startWorkflowOnce.mock.calls[0][1].workflowId).toBe(
      `reseller-deletion-cleanup-${id}-${Date.parse(DELETED_AT)}`,
    );
  });

  it('should refuse a payload without a reseller id and start nothing', async () => {
    const { consumer, startWorkflowOnce } = setUp();

    await expect(
      consumer.onStatusChanged({
        previousStatus: ResellerStatus.SUSPENDED,
        newStatus: ResellerStatus.DELETED,
      }),
    ).rejects.toBeInstanceOf(ZodError);
    expect(startWorkflowOnce).not.toHaveBeenCalled();
  });
});
