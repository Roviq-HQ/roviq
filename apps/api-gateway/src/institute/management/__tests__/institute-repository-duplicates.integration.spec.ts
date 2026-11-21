import { randomUUID } from 'node:crypto';
import { BusinessException, ErrorCode } from '@roviq/common-types';
import { createDrizzleDb, SYSTEM_USER_ID } from '@roviq/database';
import { withTestContext } from '@roviq/request-context';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_POOLER_URL } from '../../../../../../libs/database/src/__tests__/test-helpers';
import { InstituteDrizzleRepository } from '../repositories/institute.drizzle-repository';

let runtime: pg.Pool;
beforeAll(() => {
  runtime = new pg.Pool({ connectionString: TEST_POOLER_URL, max: 2 });
});
afterAll(async () => {
  await runtime.end();
});

function create(repo: InstituteDrizzleRepository, data: { slug: string; code: string }) {
  return withTestContext(
    () => repo.create({ name: { en: 'Duplicate Check' }, type: 'SCHOOL', ...data }),
    { userId: SYSTEM_USER_ID },
  );
}

describe('InstituteDrizzleRepository.create duplicates', () => {
  it('reports a taken slug or code by its error code, not as an internal error', async () => {
    const repo = new InstituteDrizzleRepository(createDrizzleDb(runtime));
    const suffix = randomUUID().slice(0, 8);
    const first = { slug: `dup-${suffix}`, code: `DUP-${suffix}` };

    await expect(create(repo, first)).resolves.toMatchObject(first);

    const slugTaken = create(repo, { slug: first.slug, code: `OTHER-${suffix}` });
    await expect(slugTaken).rejects.toBeInstanceOf(BusinessException);
    await expect(slugTaken).rejects.toHaveProperty('code', ErrorCode.SLUG_DUPLICATE);

    const codeTaken = create(repo, { slug: `other-${suffix}`, code: first.code });
    await expect(codeTaken).rejects.toBeInstanceOf(BusinessException);
    await expect(codeTaken).rejects.toHaveProperty('code', ErrorCode.INSTITUTE_CODE_DUPLICATE);
  });
});
