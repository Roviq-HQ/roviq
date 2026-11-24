/**
 * adminNotificationDeliveries: the filter input is validated like every other input.
 */
import { randomUUID } from 'node:crypto';
import { ErrorCode } from '@roviq/common-types';
import {
  createIntegrationApp,
  createPlatformToken,
  gqlRequest,
  type IntegrationAppResult,
} from '@roviq/testing/integration';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEED_IDS } from '../../../../../../e2e/shared/seed-fixtures';
import { AppModule } from '../../../app/app.module';

const QUERY = `query($filter: NotificationDeliveryFilterInput) {
  adminNotificationDeliveries(filter: $filter, first: 5) { totalCount }
}`;

describe('adminNotificationDeliveries filter (integration)', () => {
  let result: IntegrationAppResult;
  const token = createPlatformToken({
    sub: SEED_IDS.USER_ADMIN,
    membershipId: randomUUID(),
    roleId: SEED_IDS.ROLE_PLATFORM_ADMIN,
  });

  const run = (filter: Record<string, unknown> | null) =>
    gqlRequest<{ adminNotificationDeliveries: { totalCount: number } }>(result.httpServer, {
      query: QUERY,
      variables: { filter },
      token,
    });

  beforeAll(async () => {
    result = await createIntegrationApp({ modules: [AppModule] });
  });

  afterAll(async () => {
    await result?.close();
  });

  it.each([
    ['a tenant id that is not a uuid', { tenantId: 'not-a-uuid' }],
    ['a recipient id that is not a uuid', { recipientUserId: 'admin' }],
    ['a type longer than 100 characters', { type: 'X'.repeat(101) }],
  ])('should refuse %s', async (_name, filter) => {
    const { data, errors } = await run(filter);

    expect(data).toBeNull();
    expect(errors?.[0]?.extensions?.code).toBe(ErrorCode.VALIDATION_FAILED);
  });

  it('should answer a valid filter and no filter', async () => {
    for (const filter of [{ tenantId: randomUUID(), status: 'SENT' }, null]) {
      const { errors, data } = await run(filter);

      expect(errors).toBeUndefined();
      expect(typeof data?.adminNotificationDeliveries.totalCount).toBe('number');
    }
  });
});
