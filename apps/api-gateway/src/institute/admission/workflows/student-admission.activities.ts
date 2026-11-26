/**
 * Activities for StudentAdmissionWorkflow (ROV-159).
 *
 * Each activity is idempotent — checks "does this already exist?" before creating.
 * DrizzleDB + EventBusService injected via closure at worker startup.
 */
import { Logger } from '@nestjs/common';
import {
  AcademicStatus,
  AdmissionApplicationStatus,
  AdmissionType,
  DefaultRoles,
  Gender,
  GuardianRelationship,
  SocialCategory,
} from '@roviq/common-types';
import {
  admissionApplications,
  admissionApplicationsLive,
  type DrizzleDB,
  enquiriesLive,
  guardianProfiles,
  guardianProfilesLive,
  memberships,
  membershipsLive,
  mkAdminCtx,
  mkInstituteCtx,
  rolesLive,
  sectionsLive,
  studentGuardianLinks,
  studentGuardianLinksLive,
  studentProfiles,
  studentProfilesLive,
  usersLive,
  withAdmin,
  withTenant,
} from '@roviq/database';
import type { EventBusService } from '@roviq/event-bus';
import { EVENT_PATTERNS } from '@roviq/nats-jetstream';
import { ApplicationFailure } from '@temporalio/common';
import { and, eq, sql } from 'drizzle-orm';
import type { IdentityService } from '../../../auth/identity.service';
import {
  ensureTenantUserProfile,
  findActiveGuardianByPhone,
} from '../../../auth/tenant-user-profile';
import { admitStudent as admitStudentInTx } from '../../student/repositories/admit-student';
import { emitSectionCapacityWarning } from '../../student/section-norms';
import type {
  ApplicationPayload,
  EnquiryPayload,
  StudentAdmissionActivities,
} from './student-admission.types';

const logger = new Logger('StudentAdmissionActivities');

export function createStudentAdmissionActivities(
  db: DrizzleDB,
  eventBus: EventBusService,
  identityService: IdentityService,
): StudentAdmissionActivities {
  /** A failed admission must not leave the account it made behind (ROV-275). */
  async function discardAccount(userId: string): Promise<void> {
    try {
      if (!(await identityService.discardNewUser(userId))) {
        logger.warn(`Kept account ${userId} of a failed admission: it is in use`);
      }
    } catch (error) {
      logger.error(`Could not remove account ${userId} of a failed admission`, error);
    }
  }

  return {
    async loadApplicationData(applicationId, tenantId) {
      logger.log(`Loading application ${applicationId}`);

      const apps = await withTenant(
        db,
        mkInstituteCtx(tenantId, 'workflow:student-admission.activities'),
        async (tx) => {
          return tx
            .select({
              id: admissionApplicationsLive.id,
              enquiryId: admissionApplicationsLive.enquiryId,
              academicYearId: admissionApplicationsLive.academicYearId,
              standardId: admissionApplicationsLive.standardId,
              sectionId: admissionApplicationsLive.sectionId,
              formData: admissionApplicationsLive.formData,
              status: admissionApplicationsLive.status,
              isRteApplication: admissionApplicationsLive.isRteApplication,
              studentProfileId: admissionApplicationsLive.studentProfileId,
            })
            .from(admissionApplicationsLive)
            .where(eq(admissionApplicationsLive.id, applicationId))
            .limit(1);
        },
      );

      if (apps.length === 0) throw new Error(`Application ${applicationId} not found`);

      // Construct an explicit typed payload — only the fields the workflow
      // reads, using JSON-primitive types so Temporal's serialiser
      // round-trips them faithfully without custom codecs.
      const row = apps[0];
      const application: ApplicationPayload = {
        id: row.id,
        enquiryId: row.enquiryId,
        academicYearId: row.academicYearId,
        standardId: row.standardId,
        sectionId: row.sectionId,
        formData: row.formData,
        status: row.status,
        isRteApplication: row.isRteApplication,
        studentProfileId: row.studentProfileId,
      };

      let enquiry: EnquiryPayload | null = null;
      const { enquiryId } = row;
      if (enquiryId) {
        const enqs = await withTenant(
          db,
          mkInstituteCtx(tenantId, 'workflow:student-admission.activities'),
          async (tx) => {
            return tx
              .select({
                id: enquiriesLive.id,
                parentPhone: enquiriesLive.parentPhone,
                parentName: enquiriesLive.parentName,
                source: enquiriesLive.source,
              })
              .from(enquiriesLive)
              .where(eq(enquiriesLive.id, enquiryId))
              .limit(1);
          },
        );
        enquiry = enqs[0] ?? null;
      }

      return { application, enquiry };
    },

    async validateSectionCapacity(tenantId, sectionId) {
      logger.log(`Validating capacity for section ${sectionId}`);

      const sectionRows = await withTenant(
        db,
        mkInstituteCtx(tenantId, 'workflow:student-admission.activities'),
        async (tx) => {
          return tx
            .select({
              currentStrength: sectionsLive.currentStrength,
              capacity: sectionsLive.capacity,
            })
            .from(sectionsLive)
            .where(eq(sectionsLive.id, sectionId))
            .limit(1);
        },
      );

      if (sectionRows.length === 0) throw new Error(`Section ${sectionId} not found`);

      const { currentStrength, capacity } = sectionRows[0];
      if (capacity && currentStrength >= capacity) {
        logger.warn(`Section ${sectionId} at capacity (${currentStrength}/${capacity})`);
        // Warning only — hard block is in the enrollment service
      }
    },

    async admitStudent(input) {
      const { tenantId, actorId, seed, formData } = input;
      // Deterministic placeholder from the application id: a retry finds the user an earlier
      // attempt made. The parent phone belongs to the guardian (linkGuardians), never the student.
      const email = `admission-${seed}@roviq.placeholder`;
      const username = `admission-${seed}`;
      const [existing] = await withAdmin(
        db,
        mkAdminCtx('workflow:student-admission.activities'),
        (tx) =>
          tx
            .select({ id: usersLive.id })
            .from(usersLive)
            .where(eq(usersLive.email, email))
            .limit(1),
      );
      const userId =
        existing?.id ??
        (await identityService.createUser({ email, username, actorId, originTenantId: tenantId }))
          .userId;

      const firstNameStr = (formData.firstName ??
        formData.first_name ??
        formData.studentName ??
        formData.student_name ??
        'Student') as string;
      const lastNameStr = (formData.lastName ?? formData.last_name) as string | undefined;
      const name = {
        firstName: { en: firstNameStr },
        lastName: lastNameStr ? { en: lastNameStr } : null,
      };

      let admitted: Awaited<ReturnType<typeof admitInInstitute>>;
      try {
        await identityService.ensureUserProfile(userId, name, actorId);
        admitted = await admitInInstitute();
      } catch (error) {
        await discardAccount(userId);
        throw error;
      }
      if (admitted.kind !== 'ok') {
        await discardAccount(userId);
        // The class of the application is gone or the institute has no student role: a retry
        // cannot fix either.
        throw ApplicationFailure.nonRetryable(`Student not admitted: ${admitted.kind}`);
      }
      if (!existing) {
        eventBus.emit(EVENT_PATTERNS.USER.admission_created, { tenantId, userId, email, username });
      }
      emitSectionCapacityWarning(
        (pattern, payload) => eventBus.emit(pattern, payload),
        tenantId,
        admitted.strength,
      );
      return {
        userId,
        membershipId: admitted.membershipId,
        studentProfileId: admitted.studentProfileId,
        admissionNumber: admitted.admissionNumber,
      };

      /** One transaction; a retry after a committed attempt finds that attempt's student. */
      function admitInInstitute() {
        return withTenant(
          db,
          mkInstituteCtx(tenantId, 'workflow:student-admission.activities'),
          async (tx) => {
            const [done] = await tx
              .select({
                membershipId: studentProfilesLive.membershipId,
                studentProfileId: studentProfilesLive.id,
                admissionNumber: studentProfilesLive.admissionNumber,
              })
              .from(studentProfilesLive)
              .where(eq(studentProfilesLive.userId, userId))
              .limit(1);
            // An earlier attempt committed. Its warning is best effort: lost if the worker
            // stopped between that commit and the emit.
            if (done) return { kind: 'ok' as const, ...done, strength: null };
            return admitStudentInTx(tx, {
              tenantId,
              userId,
              actorId,
              academicYearId: input.academicYearId,
              standardId: input.standardId,
              sectionId: input.sectionId,
              tenantProfile: {
                ...name,
                gender: (formData.gender as Gender) ?? null,
                dateOfBirth: ((formData.dateOfBirth ?? formData.date_of_birth) as string) ?? null,
              },
              profile: {
                admissionDate: new Date().toISOString().split('T')[0],
                admissionClass: null,
                admissionType: AdmissionType.NEW,
                academicStatus: AcademicStatus.ENROLLED,
                socialCategory: (formData.socialCategory ??
                  formData.social_category ??
                  SocialCategory.GENERAL) as SocialCategory,
                caste: null,
                isMinority: false,
                minorityType: null,
                isBpl: false,
                isCwsn: false,
                cwsnType: null,
                isRteAdmitted: input.isRte,
                rteCertificate: null,
                previousSchoolName: null,
                previousSchoolBoard: null,
                previousSchoolUdise: null,
                incomingTcNumber: null,
                incomingTcDate: null,
              },
            });
          },
        );
      }
    },

    async linkGuardians(tenantId, studentProfileId, formData, createdBy, seed) {
      const parentPhone = (formData.parentPhone ?? formData.parent_phone) as string | undefined;
      const parentName = (formData.parentName ?? formData.parent_name) as string | undefined;
      const relationshipRaw = (formData.parentRelation ?? formData.parent_relation) as
        | string
        | undefined;

      if (!parentPhone && !parentName) {
        logger.warn(
          `No parent details in formData for student ${studentProfileId} — cannot link guardian`,
        );
        return;
      }

      // A typed phone number proves nothing about who typed it. An account is reused only when
      // the number already belongs to an active guardian of this institute (a sibling's
      // admission); nobody else gains a membership or a child without consenting (SF-040).
      const phone = parentPhone ? { countryCode: '+91', number: parentPhone } : undefined;
      // `created` only when this run made the account: a sibling's guardian, or a retry that
      // finds the account, gets no second welcome.
      const guardian = await (async (): Promise<{
        userId: string;
        created: { username: string; tempPassword: string } | null;
      }> => {
        if (phone) {
          const sibling = await withTenant(
            db,
            mkInstituteCtx(tenantId, 'workflow:student-admission.activities'),
            (tx) => findActiveGuardianByPhone(tx, { tenantId, phone }),
          );
          if (sibling) return { userId: sibling.userId, created: null };
        }

        // Check by deterministic placeholder email before creating — a Temporal
        // retry would otherwise fail with a unique-constraint violation on
        // `users.email` when IdentityService tries to insert the same row again.
        const email = `guardian-${seed}@roviq.placeholder`;
        const username = `guardian-${seed}`;

        const existingByEmail = await withAdmin(
          db,
          mkAdminCtx('workflow:student-admission.activities'),
          async (tx) => {
            return tx
              .select({ id: usersLive.id })
              .from(usersLive)
              .where(eq(usersLive.email, email))
              .limit(1);
          },
        );
        if (existingByEmail.length > 0) {
          logger.log(`Found existing placeholder guardian by email: ${existingByEmail[0].id}`);
          return { userId: existingByEmail[0].id, created: null };
        }

        const { userId: newId, tempPassword } = await identityService.createUser({
          email,
          username,
          // Unverified contact data: it may repeat across users and never links accounts.
          phone,
          actorId: createdBy,
          originTenantId: tenantId,
        });
        return { userId: newId, created: { username, tempPassword } };
      })();
      const guardianUserId = guardian.userId;

      if (parentName) {
        await identityService.ensureUserProfile(
          guardianUserId,
          { firstName: parentName },
          createdBy,
        );
      }

      // Find the tenant's Parent role.
      const parentRole = await withTenant(
        db,
        mkInstituteCtx(tenantId, 'workflow:student-admission.activities'),
        async (tx) => {
          return tx
            .select({ id: rolesLive.id })
            .from(rolesLive)
            .where(
              and(
                eq(rolesLive.tenantId, tenantId),
                sql`${rolesLive.name}->>'en' = ${DefaultRoles.Parent}`,
              ),
            )
            .limit(1);
        },
      );
      if (parentRole.length === 0) {
        logger.warn(`Parent role not found for tenant ${tenantId} — cannot link guardian`);
        return;
      }

      // Find-or-create the guardian's membership for this tenant.
      const membershipId = await (async (): Promise<string> => {
        const existing = await withTenant(
          db,
          mkInstituteCtx(tenantId, 'workflow:student-admission.activities'),
          async (tx) => {
            return tx
              .select({ id: membershipsLive.id })
              .from(membershipsLive)
              .where(
                and(
                  eq(membershipsLive.userId, guardianUserId),
                  eq(membershipsLive.tenantId, tenantId),
                  eq(membershipsLive.roleId, parentRole[0].id),
                ),
              )
              .limit(1);
          },
        );
        if (existing.length > 0) return existing[0].id;

        const created = await withTenant(
          db,
          mkInstituteCtx(tenantId, 'workflow:student-admission.activities'),
          async (tx) => {
            return tx
              .insert(memberships)
              .values({
                userId: guardianUserId,
                tenantId,
                roleId: parentRole[0].id,
                status: 'ACTIVE',
                abilities: [],
                createdBy,
                updatedBy: createdBy,
              })
              .returning({ id: memberships.id });
          },
        );
        return created[0].id;
      })();

      // An existing copy (a sibling's parent) is left as the institute recorded it.
      if (parentName) {
        await withTenant(
          db,
          mkInstituteCtx(tenantId, 'workflow:student-admission.activities'),
          (tx) =>
            ensureTenantUserProfile(tx, {
              tenantId,
              userId: guardianUserId,
              actorId: createdBy,
              firstName: { en: parentName },
            }),
        );
      }

      // Find-or-create the guardian_profile (one per membership, enforced by a
      // unique constraint on guardian_profiles.membership_id).
      const guardianProfileId = await (async (): Promise<string> => {
        const existing = await withTenant(
          db,
          mkInstituteCtx(tenantId, 'workflow:student-admission.activities'),
          async (tx) => {
            return tx
              .select({ id: guardianProfilesLive.id })
              .from(guardianProfilesLive)
              .where(eq(guardianProfilesLive.membershipId, membershipId))
              .limit(1);
          },
        );
        if (existing.length > 0) return existing[0].id;

        const created = await withTenant(
          db,
          mkInstituteCtx(tenantId, 'workflow:student-admission.activities'),
          async (tx) => {
            return tx
              .insert(guardianProfiles)
              .values({
                userId: guardianUserId,
                membershipId,
                tenantId,
                createdBy,
                updatedBy: createdBy,
              })
              .returning({ id: guardianProfiles.id });
          },
        );
        return created[0].id;
      })();

      // The account's email is a placeholder, so the welcome goes by SMS or not at all.
      if (guardian.created && phone) {
        identityService.sendWelcomeNotification({
          userId: guardianUserId,
          username: guardian.created.username,
          email: null,
          phone,
          firstName: parentName,
          tempPassword: guardian.created.tempPassword,
          scope: 'institute',
          tenantId,
        });
      }

      const relationship = (Object.values(GuardianRelationship) as string[]).includes(
        (relationshipRaw ?? '').toUpperCase(),
      )
        ? ((relationshipRaw as string).toUpperCase() as GuardianRelationship)
        : // Unknown or missing: record OTHER rather than guess a parent.
          GuardianRelationship.OTHER;

      // Create the student↔guardian link (idempotent — uq_student_guardian
      // prevents duplicates). Promote to primary contact when the student has
      // none, so downstream communications have a deterministic recipient.
      const existingPrimary = await withTenant(
        db,
        mkInstituteCtx(tenantId, 'workflow:student-admission.activities'),
        async (tx) => {
          return tx
            .select({ id: studentGuardianLinksLive.id })
            .from(studentGuardianLinksLive)
            .where(
              and(
                eq(studentGuardianLinksLive.studentProfileId, studentProfileId),
                eq(studentGuardianLinksLive.isPrimaryContact, true),
              ),
            )
            .limit(1);
        },
      );
      const shouldBePrimary = existingPrimary.length === 0;

      await withTenant(
        db,
        mkInstituteCtx(tenantId, 'workflow:student-admission.activities'),
        async (tx) => {
          await tx
            .insert(studentGuardianLinks)
            .values({
              createdBy,
              updatedBy: createdBy,
              tenantId,
              studentProfileId,
              guardianProfileId,
              relationship,
              isPrimaryContact: shouldBePrimary,
              isEmergencyContact: shouldBePrimary,
              canPickup: true,
              livesWith: true,
            })
            .onConflictDoNothing();
        },
      );

      eventBus.emit(EVENT_PATTERNS.GUARDIAN.linked, {
        tenantId,
        guardianProfileId,
        studentProfileId,
        relationship,
      });

      logger.log(
        `Linked guardian ${guardianProfileId} to student ${studentProfileId} as ${relationship}`,
      );
    },

    async updateApplicationEnrolled(applicationId, tenantId, studentProfileId, updatedBy) {
      const ctx = mkInstituteCtx(tenantId, 'workflow:student-admission.activities');
      const oldStatus = AdmissionApplicationStatus.FEE_PAID;
      const newStatus = AdmissionApplicationStatus.ENROLLED;

      const updated = await withTenant(db, ctx, async (tx) => {
        return tx
          .update(admissionApplications)
          .set({ status: newStatus, studentProfileId, updatedBy })
          .where(
            and(
              eq(admissionApplications.id, applicationId),
              eq(admissionApplications.status, oldStatus),
            ),
          )
          .returning({ id: admissionApplications.id });
      });

      if (updated.length === 0) {
        const rows = await withTenant(db, ctx, async (tx) => {
          return tx
            .select({ status: admissionApplicationsLive.status })
            .from(admissionApplicationsLive)
            .where(eq(admissionApplicationsLive.id, applicationId))
            .limit(1);
        });
        // Activity retry after a successful write — already enrolled, nothing to announce.
        if (rows[0]?.status === newStatus) return;
        throw ApplicationFailure.nonRetryable(
          `Application ${applicationId} is ${rows[0]?.status ?? 'missing'}, expected ${oldStatus}`,
        );
      }

      eventBus.emit(EVENT_PATTERNS.APPLICATION.status_changed, {
        applicationId,
        oldStatus,
        newStatus,
        tenantId,
      });
    },

    async emitStudentAdmittedEvent(
      tenantId,
      studentProfileId,
      membershipId,
      standardId,
      sectionId,
    ) {
      eventBus.emit(EVENT_PATTERNS.STUDENT.admitted, {
        tenantId,
        studentProfileId,
        membershipId,
        standardId,
        sectionId,
      });
      logger.log(`student.admitted emitted: student=${studentProfileId} tenant=${tenantId}`);
    },

    async applyPreviousSchoolData(tenantId, studentProfileId, formData, updatedBy) {
      const previousSchool = (formData.previousSchool ?? formData.previous_school) as
        | string
        | undefined;
      if (!previousSchool) return;

      await withTenant(
        db,
        mkInstituteCtx(tenantId, 'workflow:student-admission.activities'),
        async (tx) => {
          await tx
            .update(studentProfiles)
            .set({
              previousSchoolName: previousSchool,
              previousSchoolBoard:
                ((formData.previousBoard ?? formData.previous_board) as string) ?? null,
              updatedBy,
            })
            .where(eq(studentProfiles.id, studentProfileId));
        },
      );
    },
  };
}
