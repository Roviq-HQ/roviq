import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  cleanupTestInstitute,
  createInstituteToken,
  createIntegrationApp,
  createTestInstitute,
  gqlRequest,
  type IntegrationAppResult,
  type TestInstitute,
} from '@roviq/testing/integration';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../../app/app.module';

// A malformed id used to reach the database and come back as INTERNAL_ERROR.
describe('file id arguments are checked as UUIDs', () => {
  let app: IntegrationAppResult;
  let tenant: TestInstitute;
  let token: string;

  beforeAll(async () => {
    assert.equal(new URL(process.env.DATABASE_URL_TEST ?? '').pathname, '/roviq_test');
    app = await createIntegrationApp({ modules: [AppModule] });
    tenant = await createTestInstitute(app.db);
    token = createInstituteToken({
      sub: tenant.userId,
      membershipId: tenant.membershipId,
      roleId: tenant.roleId,
      tenantId: tenant.tenantId,
    });
  }, 60_000);

  afterAll(async () => {
    if (!app) return;
    if (tenant) await cleanupTestInstitute(app.db, tenant);
    await app.close();
  });

  async function codes(query: string, variables: Record<string, unknown>) {
    const response = await gqlRequest(app.httpServer, { token, query, variables });
    return response.errors?.map((error) => error.extensions?.code);
  }

  it('should answer BAD_REQUEST to fileDownloadUrl with a malformed id', async () => {
    expect(await codes('mutation($f: ID!) { fileDownloadUrl(fileId: $f) }', { f: 'nope' })).toEqual(
      ['BAD_REQUEST'],
    );
  });

  it('should answer BAD_REQUEST to setMyProfilePhoto with a malformed file id', async () => {
    expect(
      await codes('mutation($f: ID) { setMyProfilePhoto(fileId: $f) }', { f: 'nope' }),
    ).toEqual(['BAD_REQUEST']);
  });

  it('should answer BAD_REQUEST to setStudentPhoto with a malformed file or profile id', async () => {
    const SET = 'mutation($s: ID!, $f: ID) { setStudentPhoto(studentProfileId: $s, fileId: $f) }';
    expect(await codes(SET, { s: randomUUID(), f: 'nope' })).toEqual(['BAD_REQUEST']);
    expect(await codes(SET, { s: 'nope', f: null })).toEqual(['BAD_REQUEST']);
  });

  it('should let a null file id through to the service', async () => {
    // This test user has no profile, so the service answers; the pipe did not refuse null.
    expect(await codes('mutation($f: ID) { setMyProfilePhoto(fileId: $f) }', { f: null })).toEqual([
      'USER_PROFILE_NOT_FOUND',
    ]);
  });
});
