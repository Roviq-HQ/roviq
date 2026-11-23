/**
 * ROV-322 — correcting one student after a rollover, through GraphQL against the running stack:
 * change a student's class, remove another from the year, find them under "not placed", and
 * enrol them again.
 *
 * Runs in an institute it creates, since activation changes the active year for good. Refusals,
 * tenant isolation, the record check and CASL are covered by
 * `student-placement-correction.integration.spec.ts`.
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

async function promotionStatusIn(
  studentProfileId: string,
  academicYearId: string,
  token: string,
): Promise<string | null> {
  const res = await gql<{
    listStudentAcademics: { academicYearId: string; promotionStatus: string | null }[];
  }>(
    `query ($id: ID!) { listStudentAcademics(studentProfileId: $id) { academicYearId promotionStatus } }`,
    { id: studentProfileId },
    token,
  );
  expect(res.errors).toBeUndefined();
  const row = res.data?.listStudentAcademics.find((r) => r.academicYearId === academicYearId);
  assert(row, `no row in ${academicYearId}`);
  return row.promotionStatus;
}

async function notPlacedIn(academicYearId: string, token: string): Promise<string[]> {
  const res = await gql<{ listStudents: { edges: { node: { id: string } }[] } }>(
    `query ($filter: StudentFilterInput) { listStudents(filter: $filter) { edges { node { id } } } }`,
    { filter: { notPlacedInYearId: academicYearId, first: 50 } },
    token,
  );
  expect(res.errors).toBeUndefined();
  return res.data?.listStudents.edges.map((e) => e.node.id) ?? [];
}

describe('Student placement correction E2E', () => {
  it('changes a class, removes a student from the year, lists them as not placed and enrols them again', async () => {
    const token = await loginAsFreshInstituteAdmin(InstituteType.SCHOOL);
    const previousYearId = await activeYearId(token);
    const previousLower = await createStandardWithSection(token, previousYearId, 81);
    await createStandardWithSection(token, previousYearId, 82);
    const placement = { academicYearId: previousYearId, ...previousLower };
    const moved = await createStudentIn(token, placement, 'Diya');
    const removed = await createStudentIn(token, placement, 'Arjun');
    const nextYearId = await createNextYear(token);
    const nextLower = await createStandardWithSection(token, nextYearId, 81);
    const nextUpper = await createStandardWithSection(token, nextYearId, 82);

    await activate(token, nextYearId);
    const movedRow = await waitForYearRow(moved, nextYearId, token);
    const removedRow = await waitForYearRow(removed, nextYearId, token);
    expect(movedRow).toEqual({ id: movedRow.id, academicYearId: nextYearId, ...nextUpper });

    const changed = await gql<{ changeStudentClass: string }>(
      `mutation ($input: ChangeStudentClassInput!) { changeStudentClass(input: $input) }`,
      { input: { studentAcademicId: movedRow.id, ...nextLower } },
      token,
    );
    expect(changed.errors).toBeUndefined();
    expect(changed.data?.changeStudentClass).toBe(movedRow.id);
    expect((await history(moved, token)).find((r) => r.academicYearId === nextYearId)).toEqual({
      id: movedRow.id,
      academicYearId: nextYearId,
      ...nextLower,
    });
    expect(await promotionStatusIn(moved, previousYearId, token)).toBe(PromotionStatus.DETAINED);

    const removal = await gql<{ removeStudentFromYear: boolean }>(
      `mutation ($id: ID!, $reason: String!) { removeStudentFromYear(studentAcademicId: $id, reason: $reason) }`,
      { id: removedRow.id, reason: 'Placed in the new year by mistake' },
      token,
    );
    expect(removal.errors).toBeUndefined();
    expect(removal.data?.removeStudentFromYear).toBe(true);
    expect((await history(removed, token)).map((r) => r.academicYearId)).toEqual([previousYearId]);
    expect(await notPlacedIn(nextYearId, token)).toEqual([removed]);

    const enrolled = await gql<{ enrollStudent: string }>(
      `mutation ($input: EnrollStudentInput!) { enrollStudent(input: $input) }`,
      {
        input: {
          studentProfileId: removed,
          academicYearId: nextYearId,
          ...nextUpper,
        },
      },
      token,
    );
    expect(enrolled.errors).toBeUndefined();
    const enrolledId = enrolled.data?.enrollStudent;
    assert(enrolledId);
    expect(enrolledId).not.toBe(removedRow.id);
    expect((await history(removed, token)).find((r) => r.academicYearId === nextYearId)).toEqual({
      id: enrolledId,
      academicYearId: nextYearId,
      ...nextUpper,
    });
    expect(await notPlacedIn(nextYearId, token)).toEqual([]);
  }, 90_000);
});
