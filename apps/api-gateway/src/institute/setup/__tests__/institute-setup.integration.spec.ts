/**
 * The approval path (InstituteSetupWorkflow activities) and direct creation
 * (InstituteSetupService.runSetup) must leave an institute in the same state: the activities
 * once only logged, so an approved institute reported COMPLETED with no academic structure.
 */
import { DefaultRoles } from '@roviq/common-types';
import {
  academicYearsLive,
  type DrizzleDB,
  instituteConfigsLive,
  instituteNotificationConfigsLive,
  institutesLive,
  mkAdminCtx,
  rolesLive,
  sectionsLive,
  standardSubjectsLive,
  standardsLive,
  subjectsLive,
  withAdmin,
} from '@roviq/database';
import type { EventBusService } from '@roviq/event-bus';
import {
  createIntegrationApp,
  createMock,
  createTestInstitute,
  type IntegrationAppResult,
} from '@roviq/testing/integration';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../../app/app.module';
import { InstituteSetupService } from '../../management/seed/institute-setup.service';
import { createInstituteSetupActivities } from '../institute-setup.activities';

const SETUP = {
  type: 'SCHOOL',
  departments: ['PRIMARY', 'SECONDARY'],
  board: 'CBSE',
} as const;

async function snapshot(db: DrizzleDB, tenantId: string) {
  return withAdmin(db, mkAdminCtx('test:institute-setup'), async (tx) => {
    const count = async (query: Promise<Array<{ n: number }>>) => (await query)[0]?.n ?? 0;
    const n = sql<number>`count(*)::int`;
    const [institute] = await tx
      .select({ setupStatus: institutesLive.setupStatus })
      .from(institutesLive)
      .where(eq(institutesLive.id, tenantId));
    const configs = await tx
      .select({ norms: instituteConfigsLive.sectionStrengthNorms })
      .from(instituteConfigsLive)
      .where(eq(instituteConfigsLive.tenantId, tenantId));
    const roleNames = await tx
      .select({ name: sql<string>`${rolesLive.name}->>'en'` })
      .from(rolesLive)
      .where(eq(rolesLive.tenantId, tenantId));
    return {
      setupStatus: institute?.setupStatus,
      academicYears: await count(
        tx.select({ n }).from(academicYearsLive).where(eq(academicYearsLive.tenantId, tenantId)),
      ),
      standards: await count(
        tx.select({ n }).from(standardsLive).where(eq(standardsLive.tenantId, tenantId)),
      ),
      sections: await count(
        tx.select({ n }).from(sectionsLive).where(eq(sectionsLive.tenantId, tenantId)),
      ),
      subjects: await count(
        tx.select({ n }).from(subjectsLive).where(eq(subjectsLive.tenantId, tenantId)),
      ),
      standardSubjects: await count(
        tx
          .select({ n })
          .from(standardSubjectsLive)
          .where(eq(standardSubjectsLive.tenantId, tenantId)),
      ),
      notificationConfigs: await count(
        tx
          .select({ n })
          .from(instituteNotificationConfigsLive)
          .where(eq(instituteNotificationConfigsLive.tenantId, tenantId)),
      ),
      configs: configs.map((c) => c.norms),
      defaultRoles: roleNames
        .map((r) => r.name)
        .filter((name) => (Object.values(DefaultRoles) as string[]).includes(name))
        .sort(),
    };
  });
}

describe('Institute setup: approval workflow and direct creation (integration)', () => {
  let result: IntegrationAppResult;
  let setup: InstituteSetupService;

  beforeAll(async () => {
    result = await createIntegrationApp({ modules: [AppModule] });
    setup = result.app.get(InstituteSetupService);
  });

  afterAll(async () => {
    await result?.close();
  });

  it('the workflow activities seed the same institute that runSetup does', async () => {
    const direct = await createTestInstitute(result.db);
    const approved = await createTestInstitute(result.db);

    await setup.runSetup({ instituteId: direct.tenantId, ...SETUP, actorId: direct.userId });

    // The workflow's steps, in the workflow's order.
    const activities = createInstituteSetupActivities(
      result.db,
      createMock<EventBusService>(),
      setup,
    );
    const id = approved.tenantId;
    const actor = approved.userId;
    await activities.updateSetupStatus(id, 'IN_PROGRESS', actor);
    await activities.createDefaultRoles(id, actor);
    await activities.createDefaultNotificationConfig(id, actor);
    await activities.createInstituteConfig(id, SETUP.board, actor);
    const academicYearId = await activities.createFirstAcademicYear(id, actor);
    const counts = await activities.seedAcademicStructure(
      id,
      academicYearId,
      [...SETUP.departments],
      SETUP.board,
      SETUP.type,
      actor,
    );
    await activities.updateSetupStatus(id, 'COMPLETED', actor);
    // Temporal retries: a second run of every step changes nothing.
    await activities.createDefaultRoles(id, actor);
    await activities.createInstituteConfig(id, SETUP.board, actor);
    expect(await activities.createFirstAcademicYear(id, actor)).toBe(academicYearId);
    await activities.seedAcademicStructure(
      id,
      academicYearId,
      [...SETUP.departments],
      SETUP.board,
      SETUP.type,
      actor,
    );

    const fromDirect = await snapshot(result.db, direct.tenantId);
    const fromWorkflow = await snapshot(result.db, id);

    expect(fromWorkflow).toEqual(fromDirect);
    expect(fromWorkflow.setupStatus).toBe('COMPLETED');
    expect(fromWorkflow.academicYears).toBe(1);
    expect(fromWorkflow.standards).toBe(counts.standardsCreated);
    expect(fromWorkflow.sections).toBe(counts.sectionsCreated);
    expect(fromWorkflow.subjects).toBe(counts.subjectsSeeded);
    expect(fromWorkflow.standards).toBeGreaterThan(0);
    expect(fromWorkflow.sections).toBeGreaterThan(0);
    expect(fromWorkflow.subjects).toBeGreaterThan(0);
    expect(fromWorkflow.notificationConfigs).toBe(3);
    expect(fromWorkflow.configs).toEqual([{ optimal: 40, hardMax: 45, exemptionAllowed: true }]);
    expect(fromWorkflow.defaultRoles).toEqual([...new Set(Object.values(DefaultRoles))].sort());
  });
});
