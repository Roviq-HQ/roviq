/**
 * GroupInvalidationHandler against real PostgreSQL: which events mark which dynamic groups
 * unresolved. Each event is produced by its real operation and fed to the handler.
 */
import { randomUUID } from 'node:crypto';
import {
  DomainGroupType,
  Gender,
  GROUP_RULE_DIMENSION_VALUES,
  GroupMembershipType,
} from '@roviq/common-types';
import {
  academicYears,
  type DrizzleDB,
  groupRules,
  groups,
  mkAdminCtx,
  roles,
  SYSTEM_USER_ID,
  sections,
  standards,
  withAdmin,
} from '@roviq/database';
import { EventBusService } from '@roviq/event-bus';
import { EVENT_PATTERNS } from '@roviq/nats-jetstream';
import {
  createInstituteToken,
  createIntegrationApp,
  createTestInstitute,
  gqlRequest,
  type IntegrationAppResult,
  type TestInstitute,
} from '@roviq/testing/integration';
import { inArray } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../../../app/app.module';
import { GroupInvalidationHandler } from '../group-invalidation.handler';

const ORIGIN = 'test:group-invalidation';
const audit = { createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID };

/** One resolved dynamic group per dimension, keyed by the dimension. */
function addGroups(db: DrizzleDB, tenantId: string, dimensions: string[]) {
  return withAdmin(db, mkAdminCtx(ORIGIN), async (tx) => {
    const ids: Record<string, string> = {};
    for (const dimension of dimensions) {
      const [group] = await tx
        .insert(groups)
        .values({
          tenantId,
          ...audit,
          name: `By ${dimension} ${randomUUID().slice(0, 8)}`,
          groupType: DomainGroupType.CLUB,
          membershipType: GroupMembershipType.DYNAMIC,
          resolvedAt: new Date(),
        })
        .returning({ id: groups.id });
      await tx.insert(groupRules).values({
        tenantId,
        ...audit,
        groupId: group.id,
        rule: { '==': [{ var: dimension }, 'x'] },
        ruleDimensions: [dimension],
      });
      ids[dimension] = group.id;
    }
    return ids;
  });
}

function addSection(db: DrizzleDB, tenantId: string) {
  return withAdmin(db, mkAdminCtx(ORIGIN), async (tx) => {
    const [year] = await tx
      .insert(academicYears)
      .values({
        tenantId,
        label: '2026-27',
        startDate: '2026-04-01',
        endDate: '2027-03-31',
        ...audit,
      })
      .returning({ id: academicYears.id });
    const [standard] = await tx
      .insert(standards)
      .values({
        tenantId,
        academicYearId: year.id,
        name: { en: 'Class 5' },
        numericOrder: 5,
        level: 'PRIMARY',
        ...audit,
      })
      .returning({ id: standards.id });
    const [section] = await tx
      .insert(sections)
      .values({
        tenantId,
        standardId: standard.id,
        academicYearId: year.id,
        name: { en: 'A' },
        displayLabel: 'Class 5-A',
        capacity: 40,
        ...audit,
      })
      .returning({ id: sections.id });
    await tx.insert(roles).values({
      name: { en: 'student' },
      scope: 'institute',
      tenantId,
      abilities: [],
      isDefault: false,
      isSystem: false,
      ...audit,
    });
    return { academicYearId: year.id, standardId: standard.id, sectionId: section.id };
  });
}

describe('GroupInvalidationHandler (integration)', () => {
  let result: IntegrationAppResult;
  let handler: GroupInvalidationHandler;
  let other: TestInstitute;

  const tokenFor = (i: TestInstitute) =>
    createInstituteToken({
      sub: i.userId,
      tenantId: i.tenantId,
      membershipId: i.membershipId,
      roleId: i.roleId,
    });

  const stateOf = async (ids: Record<string, string>) => {
    const rows = await withAdmin(result.db, mkAdminCtx(ORIGIN), (tx) =>
      tx
        .select({ id: groups.id, resolvedAt: groups.resolvedAt })
        .from(groups)
        .where(inArray(groups.id, Object.values(ids))),
    );
    const byId = new Map(
      rows.map((r) => [r.id, r.resolvedAt === null ? 'unresolved' : 'resolved']),
    );
    return Object.fromEntries(Object.entries(ids).map(([key, id]) => [key, byId.get(id)]));
  };

  const emittedOnce = (spy: ReturnType<typeof vi.spyOn>, pattern: string) => {
    const payloads = spy.mock.calls.filter(([p]) => p === pattern).map(([, payload]) => payload);
    expect(payloads).toHaveLength(1);
    return payloads[0];
  };

  beforeAll(async () => {
    result = await createIntegrationApp({ modules: [AppModule] });
    handler = result.app.get(GroupInvalidationHandler);
    other = await createTestInstitute(result.db);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await result?.close();
  });

  it('should mark only shift and medium groups unresolved when a section is updated', async () => {
    const inst = await createTestInstitute(result.db);
    const { sectionId } = await addSection(result.db, inst.tenantId);
    const mine = await addGroups(result.db, inst.tenantId, [
      'shift',
      'medium',
      'section_id',
      'gender',
    ]);
    const theirs = await addGroups(result.db, other.tenantId, ['shift', 'medium']);
    const emit = vi.spyOn(result.app.get(EventBusService), 'emit');

    const response = await gqlRequest(result.httpServer, {
      query: /* GraphQL */ `
        mutation UpdateSection($id: ID!, $input: UpdateSectionInput!) {
          updateSection(id: $id, input: $input) { id }
        }`,
      token: tokenFor(inst),
      variables: { id: sectionId, input: { shift: 'Evening', mediumOfInstruction: 'Hindi' } },
    });
    expect(response.errors).toBeUndefined();
    await handler.onSectionUpdated(emittedOnce(emit, EVENT_PATTERNS.SECTION.updated));

    expect(await stateOf(mine)).toEqual({
      shift: 'unresolved',
      medium: 'unresolved',
      section_id: 'resolved',
      gender: 'resolved',
    });
    expect(await stateOf(theirs)).toEqual({ shift: 'resolved', medium: 'resolved' });
  });

  it('should mark every student dimension group of this institute unresolved when a student is admitted', async () => {
    const inst = await createTestInstitute(result.db);
    const placement = await addSection(result.db, inst.tenantId);
    const mine = await addGroups(result.db, inst.tenantId, [...GROUP_RULE_DIMENSION_VALUES]);
    const theirs = await addGroups(result.db, other.tenantId, ['gender', 'section_id']);
    const emit = vi.spyOn(result.app.get(EventBusService), 'emit');

    const response = await gqlRequest(result.httpServer, {
      query: /* GraphQL */ `
        mutation CreateStudent($input: CreateStudentInput!) { createStudent(input: $input) { id } }`,
      token: tokenFor(inst),
      variables: {
        input: { firstName: { en: 'Asha' }, gender: Gender.FEMALE, ...placement },
      },
    });
    expect(response.errors).toBeUndefined();
    await handler.onStudentAdmitted(emittedOnce(emit, EVENT_PATTERNS.STUDENT.admitted));

    expect(await stateOf(mine)).toEqual(
      Object.fromEntries(GROUP_RULE_DIMENSION_VALUES.map((d) => [d, 'unresolved'])),
    );
    expect(await stateOf(theirs)).toEqual({ gender: 'resolved', section_id: 'resolved' });
  });
});
