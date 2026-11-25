/**
 * ROV-358: a timetable write that repeats a value the database keeps unique answers its own
 * code, not INTERNAL_ERROR; the same value elsewhere is allowed.
 */
import { ErrorCode } from '@roviq/common-types';
import {
  createInstituteToken,
  createIntegrationApp,
  createTestInstitute,
  type GqlResponse,
  gqlRequest,
  type IntegrationAppResult,
} from '@roviq/testing/integration';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../../app/app.module';

const CREATE_YEAR = /* GraphQL */ `
  mutation ($input: CreateAcademicYearInput!) {
    createAcademicYear(input: $input) {
      id
    }
  }
`;
const CREATE_STANDARD = /* GraphQL */ `
  mutation ($input: CreateStandardInput!) {
    createStandard(input: $input) {
      id
    }
  }
`;
const CREATE_SECTION = /* GraphQL */ `
  mutation ($input: CreateSectionInput!) {
    createSection(input: $input) {
      id
    }
  }
`;
const CREATE_TIMETABLE = /* GraphQL */ `
  mutation ($academicYearId: ID!, $sectionIds: [ID!]!, $name: I18nText!) {
    createTimetable(
      input: {
        academicYearId: $academicYearId
        name: $name
        effectiveFrom: "2026-11-01"
        effectiveTo: "2027-02-28"
        workingDays: ["MONDAY", "TUESDAY"]
        dayStartTime: "08:00"
        defaultPeriodDurationMins: 40
        periodsCount: 2
        sectionIds: $sectionIds
        lunch: []
        extraClass: []
      }
    ) {
      id
    }
  }
`;
const UPDATE_TIMETABLE = /* GraphQL */ `
  mutation ($id: ID!, $name: I18nText!) {
    updateTimetable(id: $id, input: { name: $name }) {
      id
    }
  }
`;

interface Year {
  yearId: string;
  sectionId: string;
}

describe('timetable writes that repeat a unique value (ROV-358)', () => {
  let app: IntegrationAppResult;
  let token: string;
  let year: Year;
  let otherYear: Year;

  const gql = async <T>(query: string, variables: Record<string, unknown>) =>
    gqlRequest<T>(app.httpServer, { query, variables, token });

  const ok = <T>(res: GqlResponse<T>): T => {
    expect(res.errors).toBeUndefined();
    return res.data as T;
  };

  const setUpYear = async (label: string, startDate: string, endDate: string): Promise<Year> => {
    const { createAcademicYear } = ok(
      await gql<{ createAcademicYear: { id: string } }>(CREATE_YEAR, {
        input: { label, startDate, endDate },
      }),
    );
    const { createStandard } = ok(
      await gql<{ createStandard: { id: string } }>(CREATE_STANDARD, {
        input: { academicYearId: createAcademicYear.id, name: { en: 'Class 5' }, numericOrder: 5 },
      }),
    );
    const { createSection } = ok(
      await gql<{ createSection: { id: string } }>(CREATE_SECTION, {
        input: {
          academicYearId: createAcademicYear.id,
          standardId: createStandard.id,
          name: { en: 'A' },
        },
      }),
    );
    return { yearId: createAcademicYear.id, sectionId: createSection.id };
  };

  const createTimetable = (target: Year, name: string) =>
    gql<{ createTimetable: { id: string } }>(CREATE_TIMETABLE, {
      academicYearId: target.yearId,
      sectionIds: [target.sectionId],
      name: { en: name },
    });

  beforeAll(async () => {
    app = await createIntegrationApp({ modules: [AppModule] });
    const inst = await createTestInstitute(app.db);
    token = createInstituteToken({
      sub: inst.userId,
      tenantId: inst.tenantId,
      membershipId: inst.membershipId,
      roleId: inst.roleId,
    });
    year = await setUpYear('2026-27', '2026-04-01', '2027-03-31');
    otherYear = await setUpYear('2027-28', '2027-04-01', '2028-03-31');
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('timetable name', () => {
    it('refuses a second timetable with the same name in the year', async () => {
      ok(await createTimetable(year, 'Regular'));
      const res = await createTimetable(year, 'Regular');
      expect(res.errors?.[0]?.extensions?.code).toBe(ErrorCode.TIMETABLE_NAME_DUPLICATE);
    });

    it('refuses renaming a timetable to the name of another one in the year', async () => {
      const { createTimetable: other } = ok(await createTimetable(year, 'Winter'));
      const res = await gql(UPDATE_TIMETABLE, { id: other.id, name: { en: 'Regular' } });
      expect(res.errors?.[0]?.extensions?.code).toBe(ErrorCode.TIMETABLE_NAME_DUPLICATE);
    });

    it('allows the same name in another academic year', async () => {
      ok(await createTimetable(otherYear, 'Regular'));
    });
  });
});
