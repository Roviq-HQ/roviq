/**
 * Guardian domain E2E tests — migrated from e2e/api-gateway-e2e/hurl/guardian/*.hurl
 *
 * (Files 01-02 were deleted in earlier cleanup; the set starts at 03.)
 *
 * Covers:
 *   03-create-guardian    — createGuardian persists fields, returns a profile
 *   04-link-guardian      — linkGuardianToStudent creates a relationship
 *   05-unlink-primary     — unlink primary without replacement → error
 *                           unlink a student's only guardian → LAST_GUARDIAN_CANNOT_BE_DELETED
 *                           replacement must be another linked guardian; a valid
 *                           one becomes primary in the guardian list and student list
 *   07-revoke-access      — revokeGuardianAccess preserves the link (TC
 *                           history) but sets canPickup=false
 *   06-sibling-discovery  — myChildren as a guardian returns all linked
 *                           students (uses loginAsGuardian)
 *   08-my-profile         — myProfile returns the correct union branch based
 *                           on membership role
 *
 * Guardian names use i18nText — firstName is an `{ en: '...' }` object, not
 * a flat string (stale Hurl fields carried raw strings from pre-i18n era).
 */
import assert from 'node:assert';
import { Gender, GuardianRelationship } from '@roviq/common-types';
import type { SectionModel, StandardModel, StudentModel } from '@roviq/graphql/generated';
import { beforeAll, describe, expect, it } from 'vitest';

import { SEED } from '../../shared/seed-fixtures';
import { loginAsGuardian, loginAsInstituteAdmin } from './helpers/auth';
import { gql } from './helpers/gql-client';

interface GuardianProfile {
  id: string;
  occupation: string | null;
}

interface GuardianLink {
  id: string;
  relationship: GuardianRelationship;
  isPrimaryContact: boolean;
  canPickup: boolean;
}

describe('Guardian E2E', () => {
  let adminToken: string;
  const studentProfileId = SEED.STUDENT_PROFILE_1.id;

  // Captured by 03 and reused by 04, 05, 07
  let newGuardianId: string;

  beforeAll(async () => {
    adminToken = (await loginAsInstituteAdmin()).accessToken;
  });

  async function createStudentInFirstSection(firstName: string, gender: Gender): Promise<string> {
    const standardsRes = await gql<{ standards: Pick<StandardModel, 'id'>[] }>(
      `query Standards($academicYearId: ID!) { standards(academicYearId: $academicYearId) { id } }`,
      { academicYearId: SEED.ACADEMIC_YEAR_INST1.id },
      adminToken,
    );
    expect(standardsRes.errors).toBeUndefined();
    const standardId = standardsRes.data?.standards[0]?.id;
    assert(standardId);

    const sectionsRes = await gql<{ sections: Pick<SectionModel, 'id'>[] }>(
      `query Sections($standardId: ID!) { sections(standardId: $standardId) { id } }`,
      { standardId },
      adminToken,
    );
    expect(sectionsRes.errors).toBeUndefined();
    const sectionId = sectionsRes.data?.sections[0]?.id;
    assert(sectionId);

    const studentRes = await gql<{ createStudent: Pick<StudentModel, 'id'> }>(
      `mutation CreateStudent($input: CreateStudentInput!) { createStudent(input: $input) { id } }`,
      {
        input: {
          firstName: { en: firstName },
          gender,
          standardId,
          sectionId,
          academicYearId: SEED.ACADEMIC_YEAR_INST1.id,
        },
      },
      adminToken,
    );
    expect(studentRes.errors).toBeUndefined();
    const studentId = studentRes.data?.createStudent.id;
    assert(studentId);
    return studentId;
  }

  async function createLinkedGuardian(
    firstName: string,
    studentId: string,
    relationship: GuardianRelationship,
    isPrimaryContact: boolean,
  ): Promise<string> {
    const res = await gql<{ createGuardian: Pick<GuardianProfile, 'id'> }>(
      `mutation CreateGuardian($input: CreateGuardianInput!) { createGuardian(input: $input) { id } }`,
      {
        input: {
          firstName: { en: firstName },
          studentProfileId: studentId,
          relationship,
          isPrimaryContact,
        },
      },
      adminToken,
    );
    expect(res.errors).toBeUndefined();
    const id = res.data?.createGuardian.id;
    assert(id);
    return id;
  }

  // ─────────────────────────────────────────────────────
  // 03-create-guardian
  // ─────────────────────────────────────────────────────
  describe('createGuardian', () => {
    it('creates a guardian profile with the given fields persisted', async () => {
      const res = await gql<{ createGuardian: GuardianProfile }>(
        `mutation CreateGuardian($input: CreateGuardianInput!) {
          createGuardian(input: $input) { id occupation }
        }`,
        {
          input: {
            firstName: { en: 'Suresh' },
            lastName: { en: 'Kumar' },
            gender: Gender.MALE,
            phone: '9876502001',
            occupation: 'Government Officer',
          },
        },
        adminToken,
      );
      expect(res.errors).toBeUndefined();
      const guardian = res.data?.createGuardian;
      assert(guardian);
      expect(guardian.id).toBeTruthy();
      expect(guardian.occupation).toBe('Government Officer');
      newGuardianId = guardian.id;
    });
  });

  // ─────────────────────────────────────────────────────
  // 04-link-guardian
  // ─────────────────────────────────────────────────────
  describe('linkGuardianToStudent', () => {
    it('creates a student-guardian link with the expected fields', async () => {
      const res = await gql<{ linkGuardianToStudent: GuardianLink }>(
        `mutation LinkGuardian($input: LinkGuardianInput!) {
          linkGuardianToStudent(input: $input) {
            id relationship isPrimaryContact canPickup
          }
        }`,
        {
          input: {
            guardianProfileId: newGuardianId,
            studentProfileId,
            relationship: GuardianRelationship.FATHER,
            // Student_1 already has the seeded guardian1 as primary contact;
            // this new link must not claim primary. Otherwise we violate the
            // partial-unique index on (student_profile_id, is_primary=true).
            isPrimaryContact: false,
            canPickup: true,
          },
        },
        adminToken,
      );
      expect(res.errors).toBeUndefined();
      const link = res.data?.linkGuardianToStudent;
      assert(link);
      expect(link.id).toBeTruthy();
      expect(link.relationship).toBe(GuardianRelationship.FATHER);
      expect(link.isPrimaryContact).toBe(false);
      expect(link.canPickup).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────
  // 05-unlink-primary — negative path
  // ─────────────────────────────────────────────────────
  describe('unlinkGuardianFromStudent', () => {
    it('rejects unlinking the PRIMARY guardian without a replacement', async () => {
      // The seeded guardian1 is the primary contact for Student_1. Trying to
      // unlink without `newPrimaryGuardianId` must error out to preserve the
      // invariant that every student has exactly one primary contact.
      const res = await gql(
        `mutation UnlinkGuardian($input: UnlinkGuardianInput!) {
          unlinkGuardianFromStudent(input: $input)
        }`,
        {
          input: {
            guardianProfileId: SEED.GUARDIAN_PROFILE_1.id,
            studentProfileId,
          },
        },
        adminToken,
      );
      expect(res.errors).toBeDefined();
      assert(res.errors);
      expect(res.errors.length).toBeGreaterThan(0);
      expect(res.errors[0].message.toLowerCase()).toContain('primary');
    });

    // ROV-173 compliance #12
    it('rejects unlinking a student’s only guardian with LAST_GUARDIAN_CANNOT_BE_DELETED', async () => {
      const onlyChildId = await createStudentInFirstSection('Kavya', Gender.FEMALE);

      const linkRes = await gql<{ linkGuardianToStudent: Pick<GuardianLink, 'id'> }>(
        `mutation LinkGuardian($input: LinkGuardianInput!) { linkGuardianToStudent(input: $input) { id } }`,
        {
          input: {
            guardianProfileId: newGuardianId,
            studentProfileId: onlyChildId,
            relationship: GuardianRelationship.FATHER,
            isPrimaryContact: false,
            canPickup: true,
          },
        },
        adminToken,
      );
      expect(linkRes.errors).toBeUndefined();

      const res = await gql(
        `mutation UnlinkGuardian($input: UnlinkGuardianInput!) { unlinkGuardianFromStudent(input: $input) }`,
        { input: { guardianProfileId: newGuardianId, studentProfileId: onlyChildId } },
        adminToken,
      );
      expect(res.errors?.[0]?.extensions?.code).toBe('LAST_GUARDIAN_CANNOT_BE_DELETED');
    });

    it('does not count a deleted guardian as another guardian of the student', async () => {
      const studentId = await createStudentInFirstSection('Ishita', Gender.FEMALE);
      const fatherId = await createLinkedGuardian(
        'Vikas',
        studentId,
        GuardianRelationship.FATHER,
        true,
      );
      const uncleId = await createLinkedGuardian(
        'Imran',
        studentId,
        GuardianRelationship.UNCLE,
        false,
      );

      const del = await gql<{ deleteGuardian: boolean }>(
        `mutation DeleteGuardian($id: ID!) { deleteGuardian(id: $id) }`,
        { id: uncleId },
        adminToken,
      );
      expect(del.errors).toBeUndefined();

      const res = await gql(
        `mutation UnlinkGuardian($input: UnlinkGuardianInput!) { unlinkGuardianFromStudent(input: $input) }`,
        {
          input: {
            guardianProfileId: fatherId,
            studentProfileId: studentId,
            newPrimaryGuardianId: uncleId,
          },
        },
        adminToken,
      );
      expect(res.errors?.[0]?.extensions?.code).toBe('LAST_GUARDIAN_CANNOT_BE_DELETED');

      const delFather = await gql(
        `mutation DeleteGuardian($id: ID!) { deleteGuardian(id: $id) }`,
        { id: fatherId },
        adminToken,
      );
      expect(delFather.errors?.[0]?.extensions?.code).toBe('LAST_GUARDIAN_CANNOT_BE_DELETED');
    });

    it('rejects a replacement primary that is not linked to the student', async () => {
      const studentId = await createStudentInFirstSection('Aarav', Gender.MALE);
      const fatherId = await createLinkedGuardian(
        'Rohit',
        studentId,
        GuardianRelationship.FATHER,
        true,
      );
      await createLinkedGuardian('Kavita', studentId, GuardianRelationship.MOTHER, false);

      const res = await gql(
        `mutation UnlinkGuardian($input: UnlinkGuardianInput!) { unlinkGuardianFromStudent(input: $input) }`,
        {
          input: {
            guardianProfileId: fatherId,
            studentProfileId: studentId,
            newPrimaryGuardianId: newGuardianId,
          },
        },
        adminToken,
      );

      expect(res.errors?.[0]?.extensions?.code).toBe('REPLACEMENT_PRIMARY_GUARDIAN_INVALID');
    });

    it('unlinks the primary guardian and promotes the chosen replacement everywhere', async () => {
      const studentId = await createStudentInFirstSection('Diya', Gender.FEMALE);
      const fatherId = await createLinkedGuardian(
        'Sanjay',
        studentId,
        GuardianRelationship.FATHER,
        true,
      );
      const motherId = await createLinkedGuardian(
        'Rekha',
        studentId,
        GuardianRelationship.MOTHER,
        false,
      );

      const res = await gql<{ unlinkGuardianFromStudent: boolean }>(
        `mutation UnlinkGuardian($input: UnlinkGuardianInput!) { unlinkGuardianFromStudent(input: $input) }`,
        {
          input: {
            guardianProfileId: fatherId,
            studentProfileId: studentId,
            newPrimaryGuardianId: motherId,
          },
        },
        adminToken,
      );
      expect(res.errors).toBeUndefined();
      expect(res.data?.unlinkGuardianFromStudent).toBe(true);

      const links = await gql<{
        listStudentGuardians: { guardianProfileId: string; isPrimaryContact: boolean }[];
      }>(
        `query Links($studentProfileId: ID!) {
          listStudentGuardians(studentProfileId: $studentProfileId) { guardianProfileId isPrimaryContact }
        }`,
        { studentProfileId: studentId },
        adminToken,
      );
      expect(links.errors).toBeUndefined();
      expect(links.data?.listStudentGuardians).toEqual([
        { guardianProfileId: motherId, isPrimaryContact: true },
      ]);

      // The list row must not keep showing the unlinked (soft-deleted) primary.
      const list = await gql<{
        listStudents: {
          edges: { node: { id: string; primaryGuardianProfileId: string | null } }[];
        };
      }>(
        `query Students($filter: StudentFilterInput) {
          listStudents(filter: $filter) { edges { node { id primaryGuardianProfileId } } }
        }`,
        { filter: { search: 'Diya', first: 100 } },
        adminToken,
      );
      expect(list.errors).toBeUndefined();
      const row = list.data?.listStudents.edges.find((e) => e.node.id === studentId);
      assert(row);
      expect(row.node.primaryGuardianProfileId).toBe(motherId);
    });
  });

  // ─────────────────────────────────────────────────────
  // 07-revoke-access — divorce scenario, preserve TC history
  // ─────────────────────────────────────────────────────
  describe('revokeGuardianAccess', () => {
    it('sets canPickup=false and isPrimaryContact=false but keeps the link row', async () => {
      // Use the guardian created in 03 (non-primary — we can revoke without
      // tripping the primary-invariant check).
      const res = await gql<{
        revokeGuardianAccess: { id: string; canPickup: boolean; isPrimaryContact: boolean };
      }>(
        `mutation RevokeAccess($input: RevokeGuardianAccessInput!) {
          revokeGuardianAccess(input: $input) {
            id canPickup isPrimaryContact
          }
        }`,
        {
          input: {
            guardianProfileId: newGuardianId,
            studentProfileId,
            reason: 'Court order - custody change',
          },
        },
        adminToken,
      );
      expect(res.errors).toBeUndefined();
      const link = res.data?.revokeGuardianAccess;
      assert(link);
      expect(link.id).toBeTruthy();
      expect(link.canPickup).toBe(false);
      expect(link.isPrimaryContact).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────
  // 06-sibling-discovery — guardian-side query
  // ─────────────────────────────────────────────────────
  describe('myChildren (as guardian)', () => {
    it('returns the students linked to the logged-in guardian', async () => {
      const guardian = await loginAsGuardian();
      type Response = {
        myChildren:
          | {
              __typename: 'MyGuardianProfile';
              type: string;
              children: Array<{
                studentProfileId: string;
                relationship: GuardianRelationship;
                isPrimaryContact: boolean;
              }>;
            }
          | { __typename: string };
      };
      const res = await gql<Response>(
        `query {
          myChildren {
            __typename
            ... on MyGuardianProfile {
              type
              children { studentProfileId relationship isPrimaryContact }
            }
          }
        }`,
        undefined,
        guardian.accessToken,
      );
      expect(res.errors).toBeUndefined();
      const profile = res.data?.myChildren;
      assert(profile);
      expect(profile.__typename).toBe('MyGuardianProfile');
      // The seeded guardian1 is linked to student1 as the primary contact.
      if (profile.__typename === 'MyGuardianProfile') {
        expect(profile.children.length).toBeGreaterThanOrEqual(1);
        const link = profile.children.find((c) => c.studentProfileId === studentProfileId);
        expect(link, 'seeded guardian must be linked to SEED.STUDENT_PROFILE_1').toBeDefined();
        assert(link);
        expect(link.isPrimaryContact).toBe(true);
      }
    });
  });

  // ─────────────────────────────────────────────────────
  // 08-my-profile — union-type query
  // ─────────────────────────────────────────────────────
  describe('myProfile', () => {
    it('returns the guardian-specific branch when the caller is a guardian', async () => {
      const guardian = await loginAsGuardian();
      type Response = {
        myProfile: { __typename: string };
      };
      const res = await gql<Response>(
        `query {
          myProfile {
            __typename
            ... on MyGuardianProfile { type userProfile { firstName } children { studentProfileId } }
            ... on MyStaffProfile { type userProfile { firstName lastName } staffProfile }
            ... on MyStudentProfile { type userProfile { firstName } studentProfile }
          }
        }`,
        undefined,
        guardian.accessToken,
      );
      expect(res.errors).toBeUndefined();
      expect(res.data?.myProfile.__typename).toBe('MyGuardianProfile');
    });
  });
});
