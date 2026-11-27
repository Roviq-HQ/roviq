/**
 * ROV-293: every report-card operation that takes an id refuses a report card, instance, year,
 * term, scheme, section or student of another institute, returns none of its data, stores no
 * reference to it, renders no file and starts no workflow.
 */
import { randomUUID } from 'node:crypto';
import { ErrorCode } from '@roviq/common-types';
import { EventBusService } from '@roviq/event-bus';
import { FakeStorageClient, StorageClient } from '@roviq/storage';
import { TemporalClientService } from '@roviq/temporal';
import {
  createInstituteToken,
  createIntegrationApp,
  createTestInstitute,
  type IntegrationAppResult,
  type TestInstitute,
} from '@roviq/testing/integration';
import { Connection } from '@temporalio/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { foreignIdRequests } from '../../../__tests__/foreign-id-requests';
import { AppModule } from '../../../app/app.module';
import {
  type ExamFixture,
  examSnapshot,
  fixtureIds,
  setUpExamFixture,
} from './examination-foreign-id.fixture';

const unique = (label: string) => ({ en: `${label} ${randomUUID().slice(0, 8)}` });

const REPORT_CARDS = 'query ($yearId: ID!) { reportCards(academicYearId: $yearId) { id } }';
const REPORT_CARD = 'query ($id: ID!) { reportCard(id: $id) { id } }';
const CREATE_CARD =
  'mutation ($input: CreateReportCardInput!) { createReportCard(input: $input) { id } }';
const UPDATE_CARD = /* GraphQL */ `
  mutation ($id: ID!, $input: UpdateReportCardInput!) {
    updateReportCard(id: $id, input: $input) {
      id
    }
  }
`;
const DELETE_CARD = 'mutation ($id: ID!) { deleteReportCard(id: $id) }';
const GENERATE = /* GraphQL */ `
  mutation ($reportCardId: ID!, $sectionId: ID!) {
    generateReportCards(reportCardId: $reportCardId, sectionId: $sectionId)
  }
`;
const PUBLISH = 'mutation ($id: ID!) { publishReportCards(reportCardId: $id) }';
const INSTANCES = 'query ($id: ID!) { reportCardInstances(reportCardId: $id) { id } }';
const INSTANCE = /* GraphQL */ `
  query ($reportCardId: ID!, $studentProfileId: ID!) {
    reportCardInstance(reportCardId: $reportCardId, studentProfileId: $studentProfileId) {
      id
    }
  }
`;
const PDF = 'query ($id: ID!) { reportCardPdf(instanceId: $id) }';

describe('report cards: another institute id (ROV-293)', () => {
  let result: IntegrationAppResult;
  let instA: TestInstitute;
  let instB: TestInstitute;
  let tokenA: string;
  let a: ExamFixture;
  let b: ExamFixture;

  const request = foreignIdRequests({
    httpServer: () => result.httpServer,
    foreignIds: () => [instB, b],
    specFile: __filename,
  });
  const storage = new FakeStorageClient();

  const snapshot = () =>
    examSnapshot(result.db, [instA.tenantId, instB.tenantId], fixtureIds(b), [
      instA.userId,
      instB.userId,
    ]);

  const query = async <T>(source: string, variables: Record<string, unknown>) => {
    const res = await request<T>({ query: source, variables, token: tokenA });
    expect(res.errors).toBeUndefined();
    return res.data;
  };

  const refusesAndWritesNothing = async (
    source: string,
    variables: Record<string, unknown>,
    code: string,
  ) => {
    const before = await snapshot();
    const emit = vi.spyOn(EventBusService.prototype, 'emit');
    const put = vi.spyOn(storage, 'put');
    const connect = vi
      .spyOn(Connection, 'connect')
      .mockRejectedValue(new Error('Temporal must not be reached'));
    const startWorkflow = vi
      .spyOn(TemporalClientService.prototype, 'startWorkflow')
      .mockRejectedValue(new Error('No workflow may start'));

    const res = await request({ query: source, variables, token: tokenA });

    expect(res.errors?.[0]?.extensions?.code).toBe(code);
    expect(res.data).toBeNull();
    expect(await snapshot()).toEqual(before);
    expect(emit.mock.calls.map(([pattern]) => pattern)).toEqual([]);
    expect(put).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
    expect(startWorkflow).not.toHaveBeenCalled();
  };

  const ids = (rows: ReadonlyArray<{ id: string }> | undefined) =>
    rows?.map((row) => row.id).sort();

  beforeAll(async () => {
    result = await createIntegrationApp({
      modules: [AppModule],
      overrides: [{ provide: StorageClient, useValue: storage }],
    });
    instA = await createTestInstitute(result.db);
    instB = await createTestInstitute(result.db);
    tokenA = createInstituteToken({
      sub: instA.userId,
      tenantId: instA.tenantId,
      membershipId: instA.membershipId,
      roleId: instA.roleId,
    });
    a = await setUpExamFixture(result.db, instA);
    b = await setUpExamFixture(result.db, instB);
  });

  afterAll(async () => {
    await result?.close();
  });

  describe('reads', () => {
    it('reportCards should list its own year and nothing of another institute', async () => {
      const own = await query<{ reportCards: { id: string }[] }>(REPORT_CARDS, {
        yearId: a.yearId,
      });

      expect(ids(own?.reportCards)).toEqual(
        [a.generatedCardId, a.draftCardId, a.spareCardId].sort(),
      );
      expect(await query(REPORT_CARDS, { yearId: b.yearId })).toEqual({ reportCards: [] });
    });

    it('reportCard should refuse a report card of another institute', async () => {
      await refusesAndWritesNothing(
        REPORT_CARD,
        { id: b.generatedCardId },
        ErrorCode.REPORT_CARD_NOT_FOUND,
      );
    });

    it('reportCardInstances should list its own card and nothing of another institute', async () => {
      expect(await query(INSTANCES, { id: a.generatedCardId })).toEqual({
        reportCardInstances: [{ id: a.instanceId }],
      });
      expect(await query(INSTANCES, { id: b.generatedCardId })).toEqual({
        reportCardInstances: [],
      });
    });

    it('reportCardInstance should read its own card and student', async () => {
      expect(
        await query(INSTANCE, {
          reportCardId: a.generatedCardId,
          studentProfileId: a.student.profileId,
        }),
      ).toEqual({ reportCardInstance: { id: a.instanceId } });
    });

    it.each([
      [
        'reportCardId',
        () => ({ reportCardId: b.generatedCardId, studentProfileId: a.student.profileId }),
      ],
      [
        'studentProfileId',
        () => ({ reportCardId: a.generatedCardId, studentProfileId: b.student.profileId }),
      ],
      [
        'both ids',
        () => ({ reportCardId: b.generatedCardId, studentProfileId: b.student.profileId }),
      ],
    ] as const)('reportCardInstance should refuse %s of another institute', async (_field, variables) => {
      await refusesAndWritesNothing(INSTANCE, variables(), ErrorCode.REPORT_CARD_NOT_FOUND);
    });

    it('reportCardPdf should refuse an instance of another institute and render nothing', async () => {
      await refusesAndWritesNothing(PDF, { id: b.instanceId }, ErrorCode.REPORT_CARD_NOT_FOUND);
    });
  });

  describe('writes', () => {
    it('createReportCard should create a card with its own year, term and scheme', async () => {
      const data = await query<{ createReportCard: { id: string } }>(CREATE_CARD, {
        input: {
          academicYearId: a.yearId,
          examTermId: a.termId,
          gradingSchemeId: a.schemeId,
          name: unique('Card'),
        },
      });

      expect(data?.createReportCard.id).toMatch(/^[0-9a-f-]{36}$/);
    });

    it.each([
      ['academicYearId', () => ({ academicYearId: b.yearId }), ErrorCode.ACADEMIC_YEAR_NOT_FOUND],
      [
        'examTermId',
        () => ({ academicYearId: a.yearId, examTermId: b.termId }),
        ErrorCode.EXAM_TERM_NOT_FOUND,
      ],
      [
        'gradingSchemeId',
        () => ({ academicYearId: a.yearId, gradingSchemeId: b.schemeId }),
        ErrorCode.GRADING_SCHEME_NOT_FOUND,
      ],
    ] as const)('createReportCard should refuse %s of another institute and store nothing', async (_field, refs, code) => {
      await refusesAndWritesNothing(
        CREATE_CARD,
        { input: { ...refs(), name: unique('Card') } },
        code,
      );
    });

    it('updateReportCard should set its own term and scheme', async () => {
      const data = await query<{ updateReportCard: { id: string } }>(UPDATE_CARD, {
        id: a.spareCardId,
        input: { examTermId: a.spareTermId, gradingSchemeId: a.schemeId },
      });

      expect(data?.updateReportCard.id).toBe(a.spareCardId);
    });

    it.each([
      [
        'id',
        () => ({ id: b.draftCardId, input: { includeTopicWise: true } }),
        ErrorCode.REPORT_CARD_NOT_FOUND,
      ],
      [
        'examTermId',
        () => ({ id: a.draftCardId, input: { examTermId: b.termId } }),
        ErrorCode.EXAM_TERM_NOT_FOUND,
      ],
      [
        'gradingSchemeId',
        () => ({ id: a.draftCardId, input: { gradingSchemeId: b.schemeId } }),
        ErrorCode.GRADING_SCHEME_NOT_FOUND,
      ],
    ] as const)('updateReportCard should refuse %s of another institute and change nothing', async (_field, variables, code) => {
      await refusesAndWritesNothing(UPDATE_CARD, variables(), code);
    });

    it('deleteReportCard should refuse a report card of another institute', async () => {
      await refusesAndWritesNothing(DELETE_CARD, { id: b.spareCardId }, ErrorCode.NOT_FOUND);
    });

    it('publishReportCards should refuse a generated card of another institute', async () => {
      await refusesAndWritesNothing(
        PUBLISH,
        { id: b.generatedCardId },
        ErrorCode.REPORT_CARD_NOT_FOUND,
      );
    });

    it('generateReportCards should refuse a report card of another institute', async () => {
      await refusesAndWritesNothing(
        GENERATE,
        { reportCardId: b.draftCardId, sectionId: a.sectionId },
        ErrorCode.REPORT_CARD_NOT_FOUND,
      );
    });

    it('generateReportCards should find no student in a section of another institute', async () => {
      await refusesAndWritesNothing(
        GENERATE,
        { reportCardId: a.draftCardId, sectionId: b.sectionId },
        ErrorCode.REPORT_CARD_GENERATION_FAILED,
      );
    });

    it('generateReportCards should generate its own card for its own section', async () => {
      expect(
        await query(GENERATE, { reportCardId: a.draftCardId, sectionId: a.sectionId }),
      ).toEqual({ generateReportCards: 1 });
    });
  });
});
