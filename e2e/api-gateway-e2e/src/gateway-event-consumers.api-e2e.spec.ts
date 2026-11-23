/**
 * ROV-316 / ROV-321 — the gateway consumes its own JetStream events. Activating an academic year
 * emits `ACADEMIC_YEAR.activated`; the gateway's consumer gives continuing students a row in the
 * new year by the year-end result recorded with `setPromotionDecisions`, which becomes readable
 * through GraphQL.
 *
 * Activation is forward-only and changes an institute's active year for good, so each case runs
 * in an institute it creates. Every rule, tenant isolation and CASL refusal are covered by
 * `gateway-event-handlers.integration.spec.ts` and `year-end-promotion.integration.spec.ts`.
 */
import assert from 'node:assert';
import { InstituteType, PromotionStatus } from '@roviq/common-types';
import { describe, expect, it } from 'vitest';
import {
  activate,
  activeYearId,
  createNextYear,
  createStandardWithSection,
  createStudentIn,
  history,
  loginAsFreshInstituteAdmin,
  waitForYearRow,
} from './helpers/fresh-institute';
import { gql } from './helpers/gql-client';

describe('Gateway event consumers E2E', () => {
  it('activating a year keeps an undecided COACHING student at the same level', async () => {
    const token = await loginAsFreshInstituteAdmin(InstituteType.COACHING);
    const previousYearId = await activeYearId(token);
    const previous = await createStandardWithSection(token, previousYearId, 90);
    const studentProfileId = await createStudentIn(
      token,
      { academicYearId: previousYearId, ...previous },
      'Ananya',
    );
    const nextYearId = await createNextYear(token);
    const next = await createStandardWithSection(token, nextYearId, 90);

    await activate(token, nextYearId);

    const row = await waitForYearRow(studentProfileId, nextYearId, token);
    expect(row).toEqual({
      id: row.id,
      academicYearId: nextYearId,
      standardId: next.standardId,
      sectionId: next.sectionId,
    });
  }, 90_000);

  it('moves an undecided student up a level and keeps a DETAINED one, as the preview said', async () => {
    const token = await loginAsFreshInstituteAdmin(InstituteType.SCHOOL);
    const previousYearId = await activeYearId(token);
    const lower = await createStandardWithSection(token, previousYearId, 91);
    await createStandardWithSection(token, previousYearId, 92);
    const placement = { academicYearId: previousYearId, ...lower };
    const movingUp = await createStudentIn(token, placement, 'Kavya');
    const detained = await createStudentIn(token, placement, 'Rohan');
    const nextYearId = await createNextYear(token);
    const nextLower = await createStandardWithSection(token, nextYearId, 91);
    const nextUpper = await createStandardWithSection(token, nextYearId, 92);

    const detainedRow = (await history(detained, token)).find(
      (r) => r.academicYearId === previousYearId,
    );
    assert(detainedRow);
    const decided = await gql<{ setPromotionDecisions: number }>(
      `mutation ($input: SetPromotionDecisionsInput!) { setPromotionDecisions(input: $input) }`,
      { input: { studentAcademicIds: [detainedRow.id], status: PromotionStatus.DETAINED } },
      token,
    );
    expect(decided.errors).toBeUndefined();
    expect(decided.data?.setPromotionDecisions).toBe(1);

    const preview = await gql<{
      academicYearRolloverPreview: Record<string, number>;
    }>(
      `query ($id: ID!) {
        academicYearRolloverPreview(academicYearId: $id) {
          movingUp staying completing notCarried noClassInNewYear alreadyPlaced
        }
      }`,
      { id: nextYearId },
      token,
    );
    expect(preview.errors).toBeUndefined();
    expect(preview.data?.academicYearRolloverPreview).toEqual({
      movingUp: 1,
      staying: 1,
      completing: 0,
      notCarried: 0,
      noClassInNewYear: 0,
      alreadyPlaced: 0,
    });

    await activate(token, nextYearId);

    const up = await waitForYearRow(movingUp, nextYearId, token);
    const stayed = await waitForYearRow(detained, nextYearId, token);
    expect(up).toEqual({ id: up.id, academicYearId: nextYearId, ...nextUpper });
    expect(stayed).toEqual({ id: stayed.id, academicYearId: nextYearId, ...nextLower });
  }, 90_000);
});
