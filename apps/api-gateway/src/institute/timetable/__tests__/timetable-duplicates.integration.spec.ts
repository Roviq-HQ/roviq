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

const ADD_SECTION = /* GraphQL */ `
  mutation ($timetableId: ID!, $sectionId: ID!) {
    addTimetableSection(timetableId: $timetableId, sectionId: $sectionId) {
      id
    }
  }
`;
const ADD_PERIOD = /* GraphQL */ `
  mutation ($timetableId: ID!, $label: String!) {
    addTimetablePeriod(input: { timetableId: $timetableId, kind: "PERIOD", label: $label }) {
      id
    }
  }
`;
const UPDATE_PERIOD = /* GraphQL */ `
  mutation ($timetableId: ID!, $periodId: ID!, $label: String!) {
    updateTimetablePeriod(timetableId: $timetableId, periodId: $periodId, input: { label: $label }) {
      id
    }
  }
`;
const CREATE_OVERRIDE = /* GraphQL */ `
  mutation ($input: CreateTimetableDayOverrideInput!) {
    createTimetableDayOverride(input: $input) {
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

    it('refuses a section listed twice before anything is written', async () => {
      const res = await gql(CREATE_TIMETABLE, {
        academicYearId: year.yearId,
        sectionIds: [year.sectionId, year.sectionId],
        name: { en: 'Twice' },
      });
      expect(res.errors?.[0]?.extensions?.code).toBe(ErrorCode.VALIDATION_FAILED);
    });
  });

  describe('sections, periods and day changes', () => {
    let timetableId: string;
    let otherTimetableId: string;

    const addPeriod = (target: string, label: string) =>
      gql<{ addTimetablePeriod: { id: string } }>(ADD_PERIOD, { timetableId: target, label });

    const cancel = (periodId: string, date: string) =>
      gql<{ createTimetableDayOverride: { id: string } }>(CREATE_OVERRIDE, {
        input: {
          timetableId,
          date,
          sectionId: year.sectionId,
          periodId,
          overrideType: 'CANCELLATION',
        },
      });

    beforeAll(async () => {
      timetableId = ok(await createTimetable(year, 'Grid')).createTimetable.id;
      otherTimetableId = ok(await createTimetable(year, 'Other grid')).createTimetable.id;
    });

    it('refuses adding a section the timetable already covers', async () => {
      const res = await gql(ADD_SECTION, { timetableId, sectionId: year.sectionId });
      expect(res.errors?.[0]?.extensions?.code).toBe(ErrorCode.TIMETABLE_SECTION_DUPLICATE);
    });

    it('refuses a period label the timetable already has, on add and on rename', async () => {
      const zero = ok(await addPeriod(timetableId, 'Zero')).addTimetablePeriod.id;
      const repeated = await addPeriod(timetableId, 'Zero');
      expect(repeated.errors?.[0]?.extensions?.code).toBe(
        ErrorCode.TIMETABLE_PERIOD_LABEL_DUPLICATE,
      );

      const extra = ok(await addPeriod(timetableId, 'Extra')).addTimetablePeriod.id;
      const renamed = await gql(UPDATE_PERIOD, { timetableId, periodId: extra, label: 'Zero' });
      expect(renamed.errors?.[0]?.extensions?.code).toBe(
        ErrorCode.TIMETABLE_PERIOD_LABEL_DUPLICATE,
      );
      expect(zero).not.toBe(extra);
    });

    it('allows the same period label in another timetable', async () => {
      ok(await addPeriod(otherTimetableId, 'Zero'));
    });

    it('refuses a second change of the same period, section and date', async () => {
      const periodId = ok(await addPeriod(timetableId, 'Assembly')).addTimetablePeriod.id;
      ok(await cancel(periodId, '2026-12-07'));
      const res = await cancel(periodId, '2026-12-07');
      expect(res.errors?.[0]?.extensions?.code).toBe(ErrorCode.TIMETABLE_DAY_OVERRIDE_DUPLICATE);
      ok(await cancel(periodId, '2026-12-14'));
    });
  });
});
