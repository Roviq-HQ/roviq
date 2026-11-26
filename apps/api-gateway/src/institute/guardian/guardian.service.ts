/**
 * Guardian service (ROV-157, PRD §3.2-3.3).
 *
 * Handles guardian CRUD, student-guardian linking with primary contact enforcement,
 * sibling discovery, and divorce/access revocation.
 */

import { Injectable, Logger } from '@nestjs/common';
import { BusinessException, ErrorCode, type GuardianEducationLevel } from '@roviq/common-types';
import { EventBusService } from '@roviq/event-bus';
import { EVENT_PATTERNS } from '@roviq/nats-jetstream';
import { getRequestContext } from '@roviq/request-context';
import { IdentityService } from '../../auth/identity.service';
import { SignInDetailsService } from '../sign-in-details/sign-in-details.service';
import { englishOrFirst } from '../sign-in-details/sign-in-target';
import type { CreateGuardianInput } from './dto/create-guardian.input';
import type {
  LinkGuardianInput,
  RevokeGuardianAccessInput,
  UnlinkGuardianInput,
} from './dto/link-guardian.input';
import { GuardianRepository } from './repositories/guardian.repository';
import type { LockedGuardianLink, UnlinkPlan } from './repositories/types';

/** Refuses an unlink the rules forbid; otherwise names the link to remove and the new primary. */
function planUnlink(links: LockedGuardianLink[], input: UnlinkGuardianInput): UnlinkPlan {
  const link = links.find((l) => l.guardianProfileId === input.guardianProfileId);
  if (!link)
    throw new BusinessException(
      ErrorCode.GUARDIAN_LINK_NOT_FOUND,
      'Guardian-student link not found',
    );
  if (links.length <= 1)
    throw new BusinessException(
      ErrorCode.LAST_GUARDIAN_CANNOT_BE_DELETED,
      'Cannot unlink the last guardian from a student',
    );

  const replacement = input.newPrimaryGuardianId;
  if (link.isPrimaryContact && !replacement)
    throw new BusinessException(
      ErrorCode.PRIMARY_GUARDIAN_REQUIRED,
      'Cannot unlink primary contact without providing newPrimaryGuardianId',
    );
  const replacementLink = replacement
    ? links.find((l) => l.guardianProfileId === replacement && l.id !== link.id)
    : undefined;
  if (replacement && (!link.isPrimaryContact || !replacementLink))
    throw new BusinessException(
      ErrorCode.REPLACEMENT_PRIMARY_GUARDIAN_INVALID,
      'newPrimaryGuardianId must be another guardian linked to this student, and only when unlinking the primary contact',
    );

  return { linkId: link.id, replacementLinkId: replacementLink?.id ?? null };
}

@Injectable()
export class GuardianService {
  private readonly logger = new Logger(GuardianService.name);

  constructor(
    private readonly repo: GuardianRepository,
    private readonly eventBus: EventBusService,
    private readonly identityService: IdentityService,
    private readonly signInDetails: SignInDetailsService,
  ) {}

  private get tenantId(): string {
    const { tenantId } = getRequestContext();
    if (!tenantId) throw new Error('Tenant context required');
    return tenantId;
  }

  private get userId(): string {
    return getRequestContext().userId;
  }

  private async findById(id: string) {
    const row = await this.repo.findById(this.tenantId, id);
    if (!row)
      throw new BusinessException(ErrorCode.GUARDIAN_NOT_FOUND, `Guardian profile ${id} not found`);
    return row;
  }

  async create(input: CreateGuardianInput) {
    const tenantId = this.tenantId;
    const actorId = this.userId;

    // Before anything is written: a refused link must leave no guardian account behind.
    if (
      input.studentProfileId &&
      input.relationship &&
      !(await this.repo.studentExists(tenantId, input.studentProfileId))
    ) {
      throw new BusinessException(
        ErrorCode.STUDENT_NOT_FOUND,
        'Student profile not found in this institute',
      );
    }

    const phone = input.phone ? { countryCode: '+91', number: input.phone } : undefined;

    // Always a new guardian: a typed number never picks an existing account (SF-053). Staff
    // link a sibling to a parent already on file with `linkGuardianToStudent`.
    const suffix = crypto.randomUUID().slice(0, 12);
    const email = input.email ?? `guardian-${suffix}@roviq.placeholder`;
    const username = `guardian-${tenantId.slice(0, 8)}-${suffix}`;

    // The typed number is stored as unverified contact data, whoever else also holds it.
    const { userId: newUserId, tempPassword } = await this.identityService.createUser({
      email,
      username,
      phone,
      actorId,
      originTenantId: tenantId,
    });
    const newUser = { id: newUserId };
    await this.identityService.ensureUserProfile(
      newUser.id,
      { firstName: input.firstName, lastName: input.lastName },
      actorId,
    );

    const guardianRoleId = await this.repo.findParentRoleId(tenantId);

    if (guardianRoleId === null)
      throw new BusinessException(
        ErrorCode.ROLE_NOT_FOUND,
        'Parent role not found for this institute',
      );

    const newMembership = await this.repo.createMembership({
      tenantId,
      userId: newUser.id,
      roleId: guardianRoleId,
      actorId,
      profile: {
        firstName: input.firstName,
        lastName: input.lastName,
        gender: input.gender,
      },
    });

    const profile = await this.repo.createProfile({
      tenantId,
      userId: newUser.id,
      membershipId: newMembership.id,
      occupation: input.occupation ?? null,
      organization: input.organization ?? null,
      educationLevel: input.educationLevel ?? null,
      actorId,
    });

    this.signInDetails.sendOnCreate({
      tenantId,
      userId: newUser.id,
      username,
      email: input.email,
      phone,
      firstName: englishOrFirst(input.firstName),
      lastName: englishOrFirst(input.lastName),
      tempPassword,
    });

    if (input.studentProfileId && input.relationship) {
      await this.linkToStudent({
        guardianProfileId: profile.id,
        studentProfileId: input.studentProfileId,
        relationship: input.relationship,
        isPrimaryContact: input.isPrimaryContact ?? false,
      });
    }

    // Re-fetch via findById so the response includes the joined name/photo
    // columns populated from the institute's profile copy (mirrors student.service pattern).
    return this.findById(profile.id);
  }

  /** New temporary password for a guardian of this institute who has not signed in yet. */
  async resendSignInDetails(id: string): Promise<boolean> {
    const tenantId = this.tenantId;
    const target = await this.repo.findSignInTarget(tenantId, id);
    if (!target)
      throw new BusinessException(ErrorCode.GUARDIAN_NOT_FOUND, `Guardian profile ${id} not found`);
    await this.signInDetails.resend(tenantId, target, this.userId);
    return true;
  }

  async update(
    id: string,
    data: {
      firstName?: Record<string, string>;
      lastName?: Record<string, string>;
      occupation?: string;
      organization?: string;
      designation?: string;
      educationLevel?: GuardianEducationLevel;
      version: number;
    },
  ) {
    const tenantId = this.tenantId;
    const actorId = this.userId;

    const result = await this.repo.updateProfile(tenantId, id, actorId, data.version, {
      ...(data.occupation != null && { occupation: data.occupation }),
      ...(data.organization != null && { organization: data.organization }),
      ...(data.designation != null && { designation: data.designation }),
      ...(data.educationLevel != null && { educationLevel: data.educationLevel }),
    });

    if (result.kind === 'not_found') {
      throw new BusinessException(ErrorCode.GUARDIAN_NOT_FOUND, `Guardian ${id} not found`);
    }
    if (result.kind === 'version_mismatch') {
      throw new BusinessException(
        ErrorCode.CONCURRENT_MODIFICATION,
        'Guardian profile version mismatch',
      );
    }

    if (data.firstName !== undefined || data.lastName !== undefined) {
      await this.repo.updateInstituteProfile(tenantId, result.userId, actorId, {
        ...(data.firstName !== undefined && { firstName: data.firstName }),
        ...(data.lastName !== undefined && { lastName: data.lastName }),
      });
    }

    // Re-fetch through the joined select so the response carries the
    // updated row AND the institute's profile display fields in one object.
    return this.findById(id);
  }

  async delete(id: string) {
    const tenantId = this.tenantId;
    const actorId = this.userId;

    // Check: guardian is not the only guardian for any student
    const studentProfileIds = await this.repo.listLinkedStudentIds(tenantId, id);

    for (const studentProfileId of studentProfileIds) {
      const hasOther = await this.repo.hasOtherGuardian(tenantId, studentProfileId, id);
      if (!hasOther) {
        throw new BusinessException(
          ErrorCode.LAST_GUARDIAN_CANNOT_BE_DELETED,
          'Cannot delete guardian who is the only guardian for a student. Unlink or assign another guardian first.',
        );
      }
    }

    const deleted = await this.repo.softDelete(tenantId, id, actorId);
    if (!deleted)
      throw new BusinessException(ErrorCode.GUARDIAN_NOT_FOUND, `Guardian ${id} not found`);

    return true;
  }

  async listDeleted() {
    return this.repo.listDeleted(this.tenantId);
  }

  async restore(id: string): Promise<boolean> {
    const restored = await this.repo.restore(this.tenantId, id, this.userId);
    if (!restored) {
      throw new BusinessException(ErrorCode.GUARDIAN_NOT_FOUND, 'Deleted guardian not found');
    }
    return true;
  }

  // ── Guardian-Student Linking ──────────────────────────

  async linkToStudent(input: LinkGuardianInput) {
    const tenantId = this.tenantId;

    if (!(await this.repo.studentExists(tenantId, input.studentProfileId)))
      throw new BusinessException(
        ErrorCode.STUDENT_NOT_FOUND,
        'Student profile not found in this institute',
      );

    if (!(await this.repo.guardianExists(tenantId, input.guardianProfileId)))
      throw new BusinessException(
        ErrorCode.GUARDIAN_NOT_FOUND,
        'Guardian profile not found in this institute',
      );

    // If setting as primary contact, clear any existing primary for this student
    if (input.isPrimaryContact) {
      await this.repo.clearPrimaryContact(tenantId, input.studentProfileId, this.userId);
    }

    // The unique constraint refuses a duplicate link.
    const result = await this.repo.createLink({
      tenantId,
      actorId: this.userId,
      studentProfileId: input.studentProfileId,
      guardianProfileId: input.guardianProfileId,
      relationship: input.relationship,
      isPrimaryContact: input.isPrimaryContact ?? false,
      isEmergencyContact: input.isEmergencyContact ?? false,
      canPickup: input.canPickup ?? true,
      livesWith: input.livesWith ?? true,
    });
    if (result.kind === 'already_linked') {
      throw new BusinessException(
        ErrorCode.GUARDIAN_ALREADY_LINKED,
        'This guardian is already linked to this student',
      );
    }

    this.eventBus.emit(EVENT_PATTERNS.GUARDIAN.linked, {
      guardianProfileId: input.guardianProfileId,
      studentProfileId: input.studentProfileId,
      relationship: input.relationship,
      tenantId,
    });

    return result.link;
  }

  async unlinkFromStudent(input: UnlinkGuardianInput) {
    const tenantId = this.tenantId;

    await this.repo.unlink(tenantId, input.studentProfileId, this.userId, (links) =>
      planUnlink(links, input),
    );

    this.eventBus.emit(EVENT_PATTERNS.GUARDIAN.unlinked, {
      guardianProfileId: input.guardianProfileId,
      studentProfileId: input.studentProfileId,
      newPrimaryGuardianId: input.newPrimaryGuardianId ?? null,
      tenantId,
    });

    return true;
  }

  /**
   * Divorce/separation: revoke guardian access without deleting the link.
   * Sets can_pickup=false, is_primary_contact=false. Link preserved for TC history.
   * Only institute_admin can call this (CASL enforced at resolver level).
   */
  async revokeAccess(input: RevokeGuardianAccessInput) {
    const updated = await this.repo.revokeAccess(
      this.tenantId,
      input.studentProfileId,
      input.guardianProfileId,
      this.userId,
    );
    if (!updated)
      throw new BusinessException(
        ErrorCode.GUARDIAN_LINK_NOT_FOUND,
        'Guardian-student link not found',
      );

    this.logger.log(
      `Guardian access revoked: guardian=${input.guardianProfileId}, student=${input.studentProfileId}, reason=${input.reason ?? 'not specified'}`,
    );

    return updated;
  }

  /** Get all students linked to a guardian (sibling discovery for parent dashboard) */
  async getLinkedStudents(guardianProfileId: string) {
    return this.repo.listLinkedStudents(this.tenantId, guardianProfileId);
  }
}
