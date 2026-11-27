import { Inject, Injectable } from '@nestjs/common';
import {
  type AcademicStatus,
  type AppAbility,
  BusinessException,
  ErrorCode,
  type UserDocumentType,
} from '@roviq/common-types';
import {
  academicYearsLive,
  DRIZZLE_DB,
  type DrizzleDB,
  mapUniqueViolation,
  mkAdminCtx,
  mkInstituteCtx,
  softDelete,
  studentAcademicsLive,
  studentProfiles,
  studentProfilesLive,
  tenantUserProfilesLive,
  type UniqueViolationErrors,
  userDocuments,
  userDocumentsLive,
  withAdmin,
  withTenant,
} from '@roviq/database';
import { and, desc, eq, isNotNull, isNull, notInArray, sql } from 'drizzle-orm';
import {
  type DeleteProfileResult,
  decideMembershipEnd,
  endMembership,
  restoreMembership,
} from '../../../auth/membership-lifecycle';
import {
  type TenantUserProfileFields,
  updateTenantUserProfile,
} from '../../../auth/tenant-user-profile';
import { markFilesReady } from '../../../files/file-attachment';
import {
  attachUserDocumentFiles,
  loadUserDocumentFiles,
  removeUserDocument,
} from '../../../files/user-document-files';
import { studentReadPredicate } from '../student-read-predicate';
import { type AdmitStudentData, type AdmitStudentResult, admitStudent } from './admit-student';
import { findYearAndClass } from './class-lookup';
import { lockStudentSections, strengthChanges } from './section-strength';
import { StudentRepository } from './student.repository';
import type {
  AdmissionClassData,
  AdmissionClassResult,
  DeletedStudentRecord,
  FileRecord,
  NewStudentDocumentData,
  ProfileWriteResult,
  RestoreStudentResult,
  StudentStatusRecord,
  UserDocumentRecord,
} from './types';

const ORIGIN = 'service:student';

// Restore checks the number first; only a student admitted at the same moment gets here.
const ADMISSION_NUMBER_TAKEN: UniqueViolationErrors = {
  idx_student_admission_no_active: () =>
    new BusinessException(
      ErrorCode.ADMISSION_NUMBER_TAKEN,
      'The admission number is now used by another student',
    ),
};

@Injectable()
export class StudentDrizzleRepository extends StudentRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDB) {
    super();
  }

  admit(data: AdmitStudentData): Promise<AdmitStudentResult> {
    return withTenant(this.db, mkInstituteCtx(data.tenantId, ORIGIN), (tx) =>
      admitStudent(tx, data),
    );
  }

  checkAdmissionClass(tenantId: string, data: AdmissionClassData): Promise<AdmissionClassResult> {
    return withTenant(this.db, mkInstituteCtx(tenantId, ORIGIN), async (tx) => {
      const found = await findYearAndClass(
        tx,
        data.academicYearId,
        data.standardId,
        data.sectionId,
      );
      return found.kind === 'ok' ? { kind: 'ok' } : found;
    });
  }

  async findReadableUserId(
    tenantId: string,
    studentProfileId: string,
    ability: AppAbility,
  ): Promise<string | null> {
    const rows = await withTenant(this.db, mkInstituteCtx(tenantId, ORIGIN), async (tx) => {
      return tx
        .select({ userId: studentProfilesLive.userId })
        .from(studentProfilesLive)
        .where(
          and(eq(studentProfilesLive.id, studentProfileId), studentReadPredicate(ability, null)),
        )
        .limit(1);
    });
    return rows[0]?.userId ?? null;
  }

  // user_documents is platform-level: the caller proved the user id under tenant RLS first.
  async createDocument(
    data: NewStudentDocumentData,
  ): Promise<{ document: UserDocumentRecord; files: FileRecord[] }> {
    return withAdmin(this.db, mkAdminCtx(ORIGIN), async (tx) => {
      // The files must have been uploaded for this very student.
      await markFilesReady(tx, {
        fileIds: data.fileIds,
        purpose: data.filePurpose,
        userId: data.actorId,
        subjectUserId: data.userId,
      });
      const rows = await tx
        .insert(userDocuments)
        .values({
          createdBy: data.actorId,
          updatedBy: data.actorId,
          userId: data.userId,
          type: data.type,
          description: data.description,
          referenceNumber: data.referenceNumber,
        })
        .returning();
      const document = rows[0];
      await attachUserDocumentFiles(tx, {
        documentId: document.id,
        userId: data.userId,
        fileIds: data.fileIds,
        actorId: data.actorId,
      });
      const attached = await loadUserDocumentFiles(tx, [document.id]);
      return { document, files: attached.get(document.id) ?? [] };
    });
  }

  async findReadableDocumentType(
    tenantId: string,
    documentId: string,
    ability: AppAbility,
  ): Promise<UserDocumentType | null> {
    const documents = await withTenant(this.db, mkInstituteCtx(tenantId, ORIGIN), async (tx) => {
      return tx
        .select({ type: userDocumentsLive.type })
        .from(userDocumentsLive)
        .innerJoin(studentProfilesLive, eq(studentProfilesLive.userId, userDocumentsLive.userId))
        .where(and(eq(userDocumentsLive.id, documentId), studentReadPredicate(ability, null)))
        .limit(1);
    });
    return documents[0]?.type ?? null;
  }

  // The caller read the document under tenant RLS, joined to one of its students, first.
  removeDocument(documentId: string, actorId: string): Promise<boolean> {
    return withAdmin(this.db, mkAdminCtx(ORIGIN), (tx) =>
      removeUserDocument(tx, { documentId, actorId }),
    );
  }

  async findProfileIdByMembership(tenantId: string, membershipId: string): Promise<string | null> {
    const rows = await withTenant(this.db, mkInstituteCtx(tenantId, ORIGIN), async (tx) => {
      return tx
        .select({ id: studentProfilesLive.id })
        .from(studentProfilesLive)
        .where(eq(studentProfilesLive.membershipId, membershipId))
        .limit(1);
    });
    return rows[0]?.id ?? null;
  }

  async findStatus(tenantId: string, id: string): Promise<StudentStatusRecord | null> {
    const current = await withTenant(this.db, mkInstituteCtx(tenantId, ORIGIN), async (tx) => {
      return tx
        .select({
          academicStatus: studentProfilesLive.academicStatus,
          tcIssued: studentProfilesLive.tcIssued,
        })
        .from(studentProfilesLive)
        .where(eq(studentProfilesLive.id, id))
        .limit(1);
    });
    return current[0] ?? null;
  }

  async exists(tenantId: string, id: string): Promise<boolean> {
    const rows = await withTenant(this.db, mkInstituteCtx(tenantId, ORIGIN), async (tx) => {
      return tx
        .select({ id: studentProfilesLive.id })
        .from(studentProfilesLive)
        .where(eq(studentProfilesLive.id, id))
        .limit(1);
    });
    return rows.length > 0;
  }

  async updateProfile(
    tenantId: string,
    id: string,
    expectedVersion: number,
    updates: Record<string, unknown>,
  ): Promise<ProfileWriteResult | null> {
    return withTenant(this.db, mkInstituteCtx(tenantId, ORIGIN), async (tx) => {
      const locked = 'academicStatus' in updates ? await lockStudentSections(tx, id) : [];
      const updated = await tx
        .update(studentProfiles)
        .set({
          ...updates,
          version: sql`${studentProfiles.version} + 1`,
        })
        .where(
          and(
            eq(studentProfiles.id, id),
            eq(studentProfiles.version, expectedVersion),
            isNull(studentProfiles.deletedAt),
          ),
        )
        .returning({ id: studentProfiles.id });
      if (updated.length === 0) return null;
      return { strength: await strengthChanges(tx, locked) };
    });
  }

  async setStatus(
    tenantId: string,
    id: string,
    updates: Record<string, unknown> & { academicStatus: AcademicStatus },
  ): Promise<ProfileWriteResult | null> {
    return withTenant(this.db, mkInstituteCtx(tenantId, ORIGIN), async (tx) => {
      const locked = await lockStudentSections(tx, id);
      const updated = await tx
        .update(studentProfiles)
        .set({ ...updates, version: sql`${studentProfiles.version} + 1` })
        .where(and(eq(studentProfiles.id, id), isNull(studentProfiles.deletedAt)))
        .returning({ id: studentProfiles.id });
      if (updated.length === 0) return null;
      return { strength: await strengthChanges(tx, locked) };
    });
  }

  async updateTenantProfile(
    tenantId: string,
    id: string,
    actorId: string,
    changes: Partial<TenantUserProfileFields>,
  ): Promise<void> {
    await withTenant(this.db, mkInstituteCtx(tenantId, ORIGIN), async (tx) => {
      const [profile] = await tx
        .select({ userId: studentProfilesLive.userId })
        .from(studentProfilesLive)
        .where(eq(studentProfilesLive.id, id))
        .limit(1);
      if (!profile) return;
      await updateTenantUserProfile(tx, {
        tenantId,
        userId: profile.userId,
        actorId,
        changes,
      });
    });
  }

  async hasActiveEnrollment(
    tenantId: string,
    id: string,
    leftStatuses: AcademicStatus[],
  ): Promise<boolean> {
    const activeEnrollments = await withTenant(
      this.db,
      mkInstituteCtx(tenantId, ORIGIN),
      async (tx) => {
        return tx
          .select({ id: studentAcademicsLive.id })
          .from(studentAcademicsLive)
          .innerJoin(
            academicYearsLive,
            eq(academicYearsLive.id, studentAcademicsLive.academicYearId),
          )
          .innerJoin(
            studentProfilesLive,
            eq(studentProfilesLive.id, studentAcademicsLive.studentProfileId),
          )
          .where(
            and(
              eq(studentAcademicsLive.studentProfileId, id),
              eq(academicYearsLive.isActive, true),
              notInArray(studentProfilesLive.academicStatus, leftStatuses),
            ),
          )
          .limit(1);
      },
    );
    return activeEnrollments.length > 0;
  }

  softDelete(tenantId: string, id: string, actorId: string): Promise<DeleteProfileResult> {
    return withTenant<DeleteProfileResult>(
      this.db,
      mkInstituteCtx(tenantId, ORIGIN),
      async (tx) => {
        const [profile] = await tx
          .select({ membershipId: studentProfiles.membershipId })
          .from(studentProfiles) // allow-base-read: FOR UPDATE needs the table, not the view
          .where(and(eq(studentProfiles.id, id), isNull(studentProfiles.deletedAt)))
          .for('update');
        if (!profile) return { kind: 'not_found' };

        const decision = await decideMembershipEnd(tx, {
          membershipId: profile.membershipId,
          profileId: id,
          actorId,
        });
        if (decision === 'own_membership' || decision === 'last_admin') return { kind: decision };

        await softDelete(tx, studentProfiles, id);
        if (decision === 'end') {
          await endMembership(tx, { membershipId: profile.membershipId, actorId });
        }
        return { kind: 'deleted', membershipEnded: decision === 'end' };
      },
    );
  }

  listDeleted(tenantId: string): Promise<DeletedStudentRecord[]> {
    return withTenant(this.db, mkInstituteCtx(tenantId, ORIGIN), async (tx) => {
      return tx
        .select({
          id: studentProfiles.id,
          firstName: tenantUserProfilesLive.firstName,
          lastName: tenantUserProfilesLive.lastName,
          identifier: studentProfiles.admissionNumber,
          deletedAt: sql<Date>`${studentProfiles.deletedAt}`.mapWith(studentProfiles.deletedAt),
        })
        .from(studentProfiles) // allow-base-read: the Deleted list shows trashed rows
        .innerJoin(
          tenantUserProfilesLive,
          and(
            eq(tenantUserProfilesLive.userId, studentProfiles.userId),
            eq(tenantUserProfilesLive.tenantId, studentProfiles.tenantId),
          ),
        )
        .where(isNotNull(studentProfiles.deletedAt))
        .orderBy(desc(studentProfiles.deletedAt));
    });
  }

  restore(tenantId: string, id: string, actorId: string): Promise<RestoreStudentResult> {
    return withTenant<RestoreStudentResult>(
      this.db,
      mkInstituteCtx(tenantId, ORIGIN),
      async (tx) => {
        const [deleted] = await tx
          .select({
            admissionNumber: studentProfiles.admissionNumber,
            membershipId: studentProfiles.membershipId,
          })
          .from(studentProfiles) // allow-base-read: restore looks up a trashed row
          .where(and(eq(studentProfiles.id, id), isNotNull(studentProfiles.deletedAt)));
        if (!deleted) return { kind: 'not_found' };

        // The admission number is unique among live students only, so it may
        // have been reissued while this record sat in the Deleted list.
        const [taken] = await tx
          .select({ id: studentProfilesLive.id })
          .from(studentProfilesLive)
          .where(eq(studentProfilesLive.admissionNumber, deleted.admissionNumber))
          .limit(1);
        if (taken) {
          return { kind: 'admission_number_taken', admissionNumber: deleted.admissionNumber };
        }

        await tx
          .update(studentProfiles)
          .set({ deletedAt: null, deletedBy: null, updatedBy: actorId })
          .where(eq(studentProfiles.id, id));
        await restoreMembership(tx, { membershipId: deleted.membershipId, actorId });
        return { kind: 'restored' };
      },
    ).catch(mapUniqueViolation(ADMISSION_NUMBER_TAKEN));
  }
}
