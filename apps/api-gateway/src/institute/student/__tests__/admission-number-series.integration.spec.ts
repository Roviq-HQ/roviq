/**
 * ROV-173 compliance #10, #11, #17 — admission numbers through the real createStudent pipeline.
 *
 * Each prefix is its own series: Nursery–Class 1 share `K-`, Class 2+ are unprefixed.
 * Concurrent admissions must stay unique, gap-free and keep the right prefix.
 */
import { randomUUID } from 'node:crypto';
import { Gender } from '@roviq/common-types';
import {
  type AdmissionNumberConfig,
  academicYears,
  type DrizzleDB,
  instituteConfigs,
  mkAdminCtx,
  roles,
  SYSTEM_USER_ID,
  sections,
  standards,
  tenantSequences,
  withAdmin,
} from '@roviq/database';
import {
  createInstituteToken,
  createIntegrationApp,
  createTestInstitute,
  gqlRequest,
  type IntegrationAppResult,
} from '@roviq/testing/integration';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../../app/app.module';

const K_BAND_CONFIG: AdmissionNumberConfig = {
  format: '{prefix}{value:04d}',
  year_format: 'YYYY',
  prefixes: { '-3': 'K-', '-2': 'K-', '-1': 'K-', '1': 'K-' },
  no_prefix_from_class: 2,
};

const CREATE_STUDENT = /* GraphQL */ `
  mutation CreateStudent($input: CreateStudentInput!) {
    createStudent(input: $input) {
      admissionNumber
    }
  }
`;

interface CreateStudentResponse {
  createStudent: { admissionNumber: string };
}

interface ClassFixture {
  academicYearId: string;
  nursery: { standardId: string; sectionId: string };
  class5: { standardId: string; sectionId: string };
}

async function createInstituteFixture(db: DrizzleDB, tenantId: string): Promise<ClassFixture> {
  return withAdmin(db, mkAdminCtx('test:admission-series'), async (tx) => {
    const audit = { createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID };

    await tx.insert(instituteConfigs).values({
      tenantId,
      admissionNumberConfig: K_BAND_CONFIG,
      ...audit,
    });

    await tx.insert(roles).values({
      name: { en: 'student' },
      scope: 'institute',
      tenantId,
      abilities: [],
      isDefault: false,
      isSystem: false,
      ...audit,
    });

    const [year] = await tx
      .insert(academicYears)
      .values({
        tenantId,
        label: '2026-27',
        startDate: '2026-04-01',
        endDate: '2027-03-31',
        isActive: false,
        ...audit,
      })
      .returning({ id: academicYears.id });

    const addClass = async (
      name: string,
      numericOrder: number,
      level: 'PRE_PRIMARY' | 'PRIMARY',
    ) => {
      const [std] = await tx
        .insert(standards)
        .values({
          tenantId,
          academicYearId: year.id,
          name: { en: name },
          numericOrder,
          level,
          ...audit,
        })
        .returning({ id: standards.id });
      const [sec] = await tx
        .insert(sections)
        .values({
          tenantId,
          standardId: std.id,
          academicYearId: year.id,
          name: { en: 'A' },
          displayLabel: `${name}-A`,
          capacity: 40,
          ...audit,
        })
        .returning({ id: sections.id });
      return { standardId: std.id, sectionId: sec.id };
    };

    return {
      academicYearId: year.id,
      nursery: await addClass('Nursery', -3, 'PRE_PRIMARY'),
      class5: await addClass('Class 5', 5, 'PRIMARY'),
    };
  });
}

describe('Admission number series (integration)', () => {
  let result: IntegrationAppResult;

  const setUpInstitute = async () => {
    const institute = await createTestInstitute(result.db);
    const token = createInstituteToken({
      sub: institute.userId,
      tenantId: institute.tenantId,
      membershipId: institute.membershipId,
      roleId: institute.roleId,
    });
    const fixture = await createInstituteFixture(result.db, institute.tenantId);
    const admit = async (target: { standardId: string; sectionId: string }) => {
      const res = await gqlRequest<CreateStudentResponse>(result.httpServer, {
        query: CREATE_STUDENT,
        token,
        variables: {
          input: {
            firstName: { en: `Student ${randomUUID().slice(0, 6)}` },
            gender: Gender.FEMALE,
            academicYearId: fixture.academicYearId,
            ...target,
          },
        },
      });
      expect(res.errors).toBeUndefined();
      const admissionNumber = res.data?.createStudent.admissionNumber;
      if (!admissionNumber) throw new Error('createStudent returned no admission number');
      return admissionNumber;
    };
    return { tenantId: institute.tenantId, fixture, admit };
  };

  beforeAll(async () => {
    result = await createIntegrationApp({ modules: [AppModule] });
  });

  afterAll(async () => {
    await result?.close();
  });

  it('10 concurrent admissions across two bands → two gap-free series with correct prefixes', async () => {
    const { fixture, admit } = await setUpInstitute();

    const numbers = await Promise.all(
      Array.from({ length: 10 }, (_, i) => admit(i % 2 === 0 ? fixture.nursery : fixture.class5)),
    );

    const kBand = numbers.filter((n) => n.startsWith('K-')).sort();
    const unprefixed = numbers.filter((n) => !n.startsWith('K-')).sort();
    expect(kBand).toEqual(['K-0001', 'K-0002', 'K-0003', 'K-0004', 'K-0005']);
    expect(unprefixed).toEqual(['0001', '0002', '0003', '0004', '0005']);
  });

  it('new series continue after a legacy shared adm_no counter so old numbers never repeat', async () => {
    const { tenantId, fixture, admit } = await setUpInstitute();
    await withAdmin(result.db, mkAdminCtx('test:admission-series'), (tx) =>
      tx.insert(tenantSequences).values({
        tenantId,
        sequenceName: 'adm_no',
        currentValue: 7n,
        formatTemplate: '{prefix}{value:04d}',
      }),
    );

    expect(await admit(fixture.nursery)).toBe('K-0008');
    expect(await admit(fixture.class5)).toBe('0008');
    expect(await admit(fixture.nursery)).toBe('K-0009');
  });
});
