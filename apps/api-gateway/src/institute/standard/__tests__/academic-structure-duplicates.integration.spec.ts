/**
 * ROV-358: an academic year, standard or section saved with a value the database keeps unique
 * answers its own code, not INTERNAL_ERROR; the same value elsewhere is allowed.
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
const DELETE_YEAR = /* GraphQL */ `
  mutation ($id: ID!) {
    deleteAcademicYear(id: $id)
  }
`;
const CREATE_STANDARD = /* GraphQL */ `
  mutation ($input: CreateStandardInput!) {
    createStandard(input: $input) {
      id
    }
  }
`;
const UPDATE_STANDARD = /* GraphQL */ `
  mutation ($id: ID!, $input: UpdateStandardInput!) {
    updateStandard(id: $id, input: $input) {
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
const UPDATE_SECTION = /* GraphQL */ `
  mutation ($id: ID!, $input: UpdateSectionInput!) {
    updateSection(id: $id, input: $input) {
      id
    }
  }
`;

type Gql = <T>(query: string, variables: Record<string, unknown>) => Promise<GqlResponse<T>>;

function ok<T>(res: GqlResponse<T>): T {
  expect(res.errors).toBeUndefined();
  return res.data as T;
}

function codeOf(res: GqlResponse<unknown>): unknown {
  return res.errors?.[0]?.extensions?.code;
}

describe('academic structure writes that repeat a unique value (ROV-358)', () => {
  let app: IntegrationAppResult;
  let gqlA: Gql;
  let gqlB: Gql;

  const createYear = (gql: Gql, label: string, startYear: number) =>
    gql<{ createAcademicYear: { id: string } }>(CREATE_YEAR, {
      input: { label, startDate: `${startYear}-04-01`, endDate: `${startYear + 1}-03-31` },
    });

  const createStandard = (gql: Gql, academicYearId: string, name: string, numericOrder: number) =>
    gql<{ createStandard: { id: string } }>(CREATE_STANDARD, {
      input: { academicYearId, name: { en: name }, numericOrder },
    });

  const createSection = (gql: Gql, academicYearId: string, standardId: string, name: string) =>
    gql<{ createSection: { id: string } }>(CREATE_SECTION, {
      input: { academicYearId, standardId, name: { en: name } },
    });

  const tokenFor = async () => {
    const inst = await createTestInstitute(app.db);
    const token = createInstituteToken({
      sub: inst.userId,
      tenantId: inst.tenantId,
      membershipId: inst.membershipId,
      roleId: inst.roleId,
    });
    const gql: Gql = (query, variables) => gqlRequest(app.httpServer, { query, variables, token });
    return gql;
  };

  beforeAll(async () => {
    app = await createIntegrationApp({ modules: [AppModule] });
    gqlA = await tokenFor();
    gqlB = await tokenFor();
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('academic year label', () => {
    it('refuses the label of a deleted year of the institute', async () => {
      ok(await createYear(gqlA, '2026-27', 2026));
      const old = ok(await createYear(gqlA, '2030-31', 2030)).createAcademicYear.id;
      ok(await gqlA(DELETE_YEAR, { id: old }));

      const res = await createYear(gqlA, '2030-31', 2030);
      expect(codeOf(res)).toBe(ErrorCode.ACADEMIC_YEAR_LABEL_DUPLICATE);
    });

    it('allows the label in another institute', async () => {
      ok(await createYear(gqlB, '2030-31', 2030));
    });
  });

  describe('standards and sections', () => {
    let yearId: string;
    let otherYearId: string;
    let standardId: string;
    let otherStandardId: string;

    beforeAll(async () => {
      yearId = ok(await createYear(gqlA, '2027-28', 2027)).createAcademicYear.id;
      otherYearId = ok(await createYear(gqlA, '2028-29', 2028)).createAcademicYear.id;
      standardId = ok(await createStandard(gqlA, yearId, 'Class 1', 1)).createStandard.id;
      otherStandardId = ok(await createStandard(gqlA, yearId, 'Class 2', 2)).createStandard.id;
    });

    it('refuses a standard name the year already has, on create and on rename', async () => {
      expect(codeOf(await createStandard(gqlA, yearId, 'Class 1', 3))).toBe(
        ErrorCode.STANDARD_NAME_DUPLICATE,
      );
      const renamed = await gqlA(UPDATE_STANDARD, {
        id: otherStandardId,
        input: { name: { en: 'Class 1' } },
      });
      expect(codeOf(renamed)).toBe(ErrorCode.STANDARD_NAME_DUPLICATE);
    });

    it('refuses a numeric order the year already has, on create and on update', async () => {
      expect(codeOf(await createStandard(gqlA, yearId, 'Class One', 1))).toBe(
        ErrorCode.STANDARD_ORDER_DUPLICATE,
      );
      const moved = await gqlA(UPDATE_STANDARD, {
        id: otherStandardId,
        input: { numericOrder: 1 },
      });
      expect(codeOf(moved)).toBe(ErrorCode.STANDARD_ORDER_DUPLICATE);
    });

    it('allows the same standard name and order in another year', async () => {
      ok(await createStandard(gqlA, otherYearId, 'Class 1', 1));
    });

    it('refuses a section name the standard already has, on create and on rename', async () => {
      ok(await createSection(gqlA, yearId, standardId, 'A'));
      const b = ok(await createSection(gqlA, yearId, standardId, 'B')).createSection.id;

      expect(codeOf(await createSection(gqlA, yearId, standardId, 'A'))).toBe(
        ErrorCode.SECTION_NAME_DUPLICATE,
      );
      const renamed = await gqlA(UPDATE_SECTION, { id: b, input: { name: { en: 'A' } } });
      expect(codeOf(renamed)).toBe(ErrorCode.SECTION_NAME_DUPLICATE);
    });

    it('allows the same section name in another standard', async () => {
      ok(await createSection(gqlA, yearId, otherStandardId, 'A'));
    });
  });
});
