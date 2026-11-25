/**
 * ROV-358: an examination record saved with a value the database keeps unique answers its own
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

const create = (operation: string, inputType: string) => /* GraphQL */ `
  mutation ($input: ${inputType}!) {
    ${operation}(input: $input) {
      id
    }
  }
`;
const update = (operation: string, inputType: string) => /* GraphQL */ `
  mutation ($id: ID!, $input: ${inputType}!) {
    ${operation}(id: $id, input: $input) {
      id
    }
  }
`;
const REPLACE_BANDS = /* GraphQL */ `
  mutation ($input: ReplaceGradeBandsInput!) {
    replaceGradeBands(input: $input) {
      id
    }
  }
`;

const BANDS = [
  { grade: 'A', minPercent: 50, maxPercent: 100, gradePoint: 10 },
  { grade: 'B', minPercent: 0, maxPercent: 49, gradePoint: 5 },
];

type Gql = <T = { [operation: string]: { id: string } }>(
  query: string,
  variables: Record<string, unknown>,
) => Promise<GqlResponse<T>>;

function idOf(res: GqlResponse<{ [operation: string]: { id: string } }>): string {
  expect(res.errors).toBeUndefined();
  const [node] = Object.values(res.data ?? {});
  return node.id;
}

function codeOf(res: GqlResponse<unknown>): unknown {
  return res.errors?.[0]?.extensions?.code;
}

describe('examination writes that repeat a unique value (ROV-358)', () => {
  let app: IntegrationAppResult;
  let gqlA: Gql;
  let gqlB: Gql;
  let yearId: string;
  let otherYearId: string;
  let standardId: string;
  let otherStandardId: string;
  let sectionId: string;
  let otherSectionId: string;
  let subjectId: string;

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

  const createIn = (gql: Gql, operation: string, inputType: string, input: object) =>
    gql(create(operation, inputType), { input });

  beforeAll(async () => {
    app = await createIntegrationApp({ modules: [AppModule] });
    gqlA = await tokenFor();
    gqlB = await tokenFor();
    const year = (label: string, start: number) =>
      createIn(gqlA, 'createAcademicYear', 'CreateAcademicYearInput', {
        label,
        startDate: `${start}-04-01`,
        endDate: `${start + 1}-03-31`,
      });
    yearId = idOf(await year('2026-27', 2026));
    otherYearId = idOf(await year('2027-28', 2027));
    const standard = (name: string, numericOrder: number) =>
      createIn(gqlA, 'createStandard', 'CreateStandardInput', {
        academicYearId: yearId,
        name: { en: name },
        numericOrder,
      });
    standardId = idOf(await standard('Class 6', 6));
    otherStandardId = idOf(await standard('Class 7', 7));
    const section = (name: string) =>
      createIn(gqlA, 'createSection', 'CreateSectionInput', {
        academicYearId: yearId,
        standardId,
        name: { en: name },
      });
    sectionId = idOf(await section('A'));
    otherSectionId = idOf(await section('B'));
    subjectId = idOf(
      await createIn(gqlA, 'createSubject', 'CreateSubjectInput', {
        name: 'Science',
        standardIds: [standardId, otherStandardId],
        sectionIds: [sectionId, otherSectionId],
      }),
    );
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('names kept unique per academic year', () => {
    it.each([
      [
        'exam term',
        'createExamTerm',
        'CreateExamTermInput',
        'updateExamTerm',
        'UpdateExamTermInput',
        {},
        ErrorCode.EXAM_TERM_NAME_DUPLICATE,
      ],
      [
        'exam',
        'createExam',
        'CreateExamInput',
        'updateExam',
        'UpdateExamInput',
        { type: 'UNIT_TEST' },
        ErrorCode.EXAM_NAME_DUPLICATE,
      ],
      [
        'report card',
        'createReportCard',
        'CreateReportCardInput',
        'updateReportCard',
        'UpdateReportCardInput',
        {},
        ErrorCode.REPORT_CARD_NAME_DUPLICATE,
      ],
    ] as const)('refuses a repeated %s name, on create and on rename, and allows it in another year', async (_label, createOp, createType, updateOp, updateType, extra, code) => {
      const input = (academicYearId: string, name: string) => ({
        academicYearId,
        name: { en: name },
        ...extra,
      });
      idOf(await createIn(gqlA, createOp, createType, input(yearId, 'Term 1')));
      expect(codeOf(await createIn(gqlA, createOp, createType, input(yearId, 'Term 1')))).toBe(
        code,
      );

      const second = idOf(await createIn(gqlA, createOp, createType, input(yearId, 'Term 2')));
      const renamed = await gqlA(update(updateOp, updateType), {
        id: second,
        input: { name: { en: 'Term 1' } },
      });
      expect(codeOf(renamed)).toBe(code);

      idOf(await createIn(gqlA, createOp, createType, input(otherYearId, 'Term 1')));
    });
  });

  describe('names kept unique per institute', () => {
    const scheme = (name: string) => ({ name: { en: name }, kind: 'SCHOLASTIC', bands: BANDS });

    it('refuses a repeated grading scheme name, on create and on rename', async () => {
      idOf(await createIn(gqlA, 'createGradingScheme', 'CreateGradingSchemeInput', scheme('CBSE')));
      expect(
        codeOf(
          await createIn(gqlA, 'createGradingScheme', 'CreateGradingSchemeInput', scheme('CBSE')),
        ),
      ).toBe(ErrorCode.GRADING_SCHEME_NAME_DUPLICATE);

      const other = idOf(
        await createIn(gqlA, 'createGradingScheme', 'CreateGradingSchemeInput', scheme('State')),
      );
      const renamed = await gqlA(update('updateGradingScheme', 'UpdateGradingSchemeInput'), {
        id: other,
        input: { name: { en: 'CBSE' } },
      });
      expect(codeOf(renamed)).toBe(ErrorCode.GRADING_SCHEME_NAME_DUPLICATE);
    });

    it('refuses a grade that appears twice in the bands, on create and on replace', async () => {
      const twice = [
        { grade: 'A', minPercent: 50, maxPercent: 100, gradePoint: 10 },
        { grade: 'A', minPercent: 0, maxPercent: 49, gradePoint: 5 },
      ];
      const created = await createIn(gqlA, 'createGradingScheme', 'CreateGradingSchemeInput', {
        ...scheme('Twice'),
        bands: twice,
      });
      expect(codeOf(created)).toBe(ErrorCode.GRADING_SCHEME_INVALID_BANDS);

      const gradingSchemeId = idOf(
        await createIn(gqlA, 'createGradingScheme', 'CreateGradingSchemeInput', scheme('Replace')),
      );
      const replaced = await gqlA(REPLACE_BANDS, { input: { gradingSchemeId, bands: twice } });
      expect(codeOf(replaced)).toBe(ErrorCode.GRADING_SCHEME_INVALID_BANDS);
    });

    it('refuses a repeated co-scholastic area name', async () => {
      const area = { name: { en: 'Art Education' } };
      idOf(await createIn(gqlA, 'createCoScholasticArea', 'CreateCoScholasticAreaInput', area));
      expect(
        codeOf(await createIn(gqlA, 'createCoScholasticArea', 'CreateCoScholasticAreaInput', area)),
      ).toBe(ErrorCode.CO_SCHOLASTIC_AREA_NAME_DUPLICATE);
    });

    it('allows the same grading scheme and co-scholastic area names in another institute', async () => {
      idOf(await createIn(gqlB, 'createGradingScheme', 'CreateGradingSchemeInput', scheme('CBSE')));
      idOf(
        await createIn(gqlB, 'createCoScholasticArea', 'CreateCoScholasticAreaInput', {
          name: { en: 'Art Education' },
        }),
      );
    });
  });

  describe('topic codes and exam papers', () => {
    it('refuses a topic code the subject already has in the standard, and allows it in another', async () => {
      const topic = (standard: string, name: string) =>
        createIn(gqlA, 'createSubjectTopic', 'CreateSubjectTopicInput', {
          subjectId,
          standardId: standard,
          code: 'SCI-1',
          name: { en: name },
        });
      idOf(await topic(standardId, 'Plants'));
      expect(codeOf(await topic(standardId, 'Animals'))).toBe(
        ErrorCode.SUBJECT_TOPIC_CODE_DUPLICATE,
      );
      idOf(await topic(otherStandardId, 'Plants'));
    });

    it('refuses a second paper for the same section, subject and component', async () => {
      const examId = idOf(
        await createIn(gqlA, 'createExam', 'CreateExamInput', {
          academicYearId: yearId,
          name: { en: 'Half yearly' },
          type: 'HALF_YEARLY',
        }),
      );
      const paper = (section: string) =>
        createIn(gqlA, 'addExamSchedule', 'CreateExamScheduleInput', {
          examId,
          sectionId: section,
          subjectId,
          component: 'THEORY',
          maxMarks: 80,
        });
      idOf(await paper(sectionId));
      expect(codeOf(await paper(sectionId))).toBe(ErrorCode.EXAM_SCHEDULE_DUPLICATE);
      idOf(await paper(otherSectionId));
    });
  });
});
