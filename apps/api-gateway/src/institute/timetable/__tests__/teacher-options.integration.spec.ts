/**
 * teacherOptions access — integration tests.
 *
 * Teachers read timetables but not the staff directory, so timetable UIs
 * resolve teacher names through the names-only `teacherOptions` query
 * (guarded by read:Timetable) instead of `listStaff`. Pins both sides:
 * the teacher passes here and is still rejected on the full directory.
 */

import { mkAdminCtx, roles, withAdmin } from '@roviq/database';
import {
  cleanupTestInstitute,
  cleanupTestTeacher,
  createInstituteToken,
  createIntegrationApp,
  createTestInstitute,
  createTestTeacher,
  gqlRequest,
  type IntegrationAppResult,
  type TestInstitute,
  type TestTeacher,
} from '@roviq/testing/integration';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../../app/app.module';

describe('teacherOptions access', () => {
  let result: IntegrationAppResult;
  let tenant: TestInstitute;
  let teacher: TestTeacher;
  let adminToken: string;
  let teacherToken: string;

  beforeAll(async () => {
    result = await createIntegrationApp({ modules: [AppModule] });
    tenant = await createTestInstitute(result.db);
    teacher = await createTestTeacher(result.db, tenant.tenantId);

    // The shared fixture grants a deliberately minimal set; production
    // class_teacher also reads timetables (but still not staff).
    await withAdmin(result.db, mkAdminCtx('test:teacher-options'), async (tx) => {
      const [row] = await tx
        .select({ abilities: roles.abilities })
        .from(roles)
        .where(eq(roles.id, teacher.roleId))
        .limit(1);
      await tx
        .update(roles)
        .set({ abilities: [...(row?.abilities ?? []), { action: 'read', subject: 'Timetable' }] })
        .where(eq(roles.id, teacher.roleId));
    });

    adminToken = createInstituteToken({
      sub: tenant.userId,
      tenantId: tenant.tenantId,
      membershipId: tenant.membershipId,
      roleId: tenant.roleId,
    });
    teacherToken = createInstituteToken({
      sub: teacher.userId,
      tenantId: tenant.tenantId,
      membershipId: teacher.membershipId,
      roleId: teacher.roleId,
    });
  });

  afterAll(async () => {
    if (teacher) await cleanupTestTeacher(result.db, teacher);
    if (tenant) await cleanupTestInstitute(result.db, tenant);
    await result?.close();
  });

  it('teacher can read teacherOptions (has read:Timetable)', async () => {
    const response = await gqlRequest(result.httpServer, {
      query: `query { teacherOptions { membershipId firstName lastName } }`,
      token: teacherToken,
    });
    expect(response.errors).toBeUndefined();
    expect(Array.isArray(response.data?.teacherOptions)).toBe(true);
  });

  it('admin can read teacherOptions', async () => {
    const response = await gqlRequest(result.httpServer, {
      query: `query { teacherOptions { membershipId } }`,
      token: adminToken,
    });
    expect(response.errors).toBeUndefined();
    expect(Array.isArray(response.data?.teacherOptions)).toBe(true);
  });

  it('teacher still cannot read the staff directory', async () => {
    const response = await gqlRequest(result.httpServer, {
      query: `query { listStaff { membershipId } }`,
      token: teacherToken,
    });
    expect(response.errors).toBeDefined();
    expect(response.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
  });
});
