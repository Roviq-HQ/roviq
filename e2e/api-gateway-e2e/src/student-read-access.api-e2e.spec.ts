import assert from 'node:assert/strict';
import { describe, expect, it } from 'vitest';
import { SEED } from '../../shared/seed-fixtures';
import {
  E2eCreateReadAccessStudentDocument,
  E2eDeleteReadAccessStudentDocument,
  E2eReadAccessSectionsDocument,
  E2eReadAccessStandardsDocument,
  E2eUpdateReadAccessStudentDocument,
  E2eWithdrawReadAccessStudentDocument,
} from './__generated__/graphql';
import { loginAsInstituteAdmin, loginAsStudent } from './helpers/auth';
import { gql } from './helpers/gql-client';
import { subscribeOnce } from './helpers/ws-client';

describe('Student read access over WebSocket', () => {
  it('delivers an authorized record and rejects other student rows and mismatched IDs', async () => {
    const admin = await loginAsInstituteAdmin();
    const student = await loginAsStudent();
    const standards = await gql(
      E2eReadAccessStandardsDocument,
      { yearId: SEED.ACADEMIC_YEAR_INST1.id },
      admin.accessToken,
    );
    expect(standards.errors).toBeUndefined();
    const standard = standards.data?.standards[0];
    assert(standard);
    const sections = await gql(
      E2eReadAccessSectionsDocument,
      { standardId: standard.id },
      admin.accessToken,
    );
    expect(sections.errors).toBeUndefined();
    const section = sections.data?.sections[0];
    assert(section);
    const created = await gql(
      E2eCreateReadAccessStudentDocument,
      {
        input: {
          firstName: { en: 'Read access fixture' },
          academicYearId: SEED.ACADEMIC_YEAR_INST1.id,
          sectionId: section.id,
          standardId: standard.id,
        },
      },
      admin.accessToken,
    );
    expect(created.errors).toBeUndefined();
    const fixture = created.data?.createStudent;
    assert(fixture?.version);
    try {
      const allowed = subscribeOnce<{
        studentUpdated: { id: string; medicalInfo: null; bloodGroup: string };
      }>(
        'subscription($id: ID!) { studentUpdated(studentId: $id) { id bloodGroup medicalInfo { allergies } } }',
        { id: fixture.id },
        admin.accessToken,
      );
      const deniedRow = expect(
        subscribeOnce(
          'subscription { studentsInTenantUpdated { id } }',
          {},
          student.accessToken,
          2500,
        ),
      ).rejects.toThrow('Subscription timeout');
      const deniedId = expect(
        subscribeOnce(
          'subscription($id: ID!) { studentUpdated(studentId: $id) { id } }',
          { id: SEED.STUDENT_PROFILE_1.id },
          admin.accessToken,
          2500,
        ),
      ).rejects.toThrow('Subscription timeout');
      await new Promise((resolve) => setTimeout(resolve, 200));
      const updated = await gql(
        E2eUpdateReadAccessStudentDocument,
        {
          id: fixture.id,
          input: { version: fixture.version, bloodGroup: 'O+' },
        },
        admin.accessToken,
      );
      expect(updated.errors).toBeUndefined();
      expect((await allowed).studentUpdated).toEqual({
        id: fixture.id,
        medicalInfo: null,
        bloodGroup: 'O+',
      });
      await Promise.all([deniedRow, deniedId]);
    } finally {
      const withdrawn = await gql(
        E2eWithdrawReadAccessStudentDocument,
        { id: fixture.id },
        admin.accessToken,
      );
      expect(withdrawn.errors).toBeUndefined();
      const deleted = await gql(
        E2eDeleteReadAccessStudentDocument,
        { id: fixture.id },
        admin.accessToken,
      );
      expect(deleted.errors).toBeUndefined();
      expect(deleted.data?.deleteStudent).toBe(true);
    }
  });
});
