/**
 * Staff service (ROV-157).
 *
 * Handles staff CRUD, employee_id generation, and NATS events.
 * Queries live in `StaffRepository`, which runs them under the institute's RLS context.
 */

import { Injectable, Logger } from '@nestjs/common';
import { BusinessException, EmploymentType, ErrorCode } from '@roviq/common-types';
import { EventBusService } from '@roviq/event-bus';
import { EVENT_PATTERNS } from '@roviq/nats-jetstream';
import { getRequestContext } from '@roviq/request-context';
import { IdentityService } from '../../auth/identity.service';
import { SignInDetailsService } from '../sign-in-details/sign-in-details.service';
import { englishOrFirst } from '../sign-in-details/sign-in-target';
import type { CreateStaffInput } from './dto/create-staff.input';
import type { ListStaffFilterInput } from './dto/list-staff-filter.input';
import type { UpdateStaffInput } from './dto/update-staff.input';
import { StaffRepository } from './repositories/staff.repository';
import type { CreateStaffResult } from './repositories/staff.types';

@Injectable()
export class StaffService {
  private readonly logger = new Logger(StaffService.name);

  constructor(
    private readonly repo: StaffRepository,
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

  async findById(id: string) {
    const row = await this.repo.findById(this.tenantId, id);
    if (!row)
      throw new BusinessException(ErrorCode.STAFF_NOT_FOUND, `Staff profile ${id} not found`);
    return row;
  }

  async list(filter: ListStaffFilterInput) {
    return this.repo.list(this.tenantId, {
      department: filter.department,
      designation: filter.designation,
      employmentType: filter.employmentType,
      isClassTeacher: filter.isClassTeacher,
      search: filter.search,
      limit: filter.first ?? 20,
    });
  }

  async create(input: CreateStaffInput) {
    const tenantId = this.tenantId;
    const actorId = this.userId;

    // PRD §2.3 rule 2: date_of_joining must not be in the future
    if (input.dateOfJoining) {
      const today = new Date().toISOString().split('T')[0];
      if (input.dateOfJoining > today) {
        throw new BusinessException(
          ErrorCode.VALIDATION_FAILED,
          'date_of_joining must not be in the future',
        );
      }
    }

    // Both checked before the account exists, so these refusals write nothing.
    const typedEmployeeId = input.employeeId?.trim() || null;
    if (typedEmployeeId && (await this.repo.isEmployeeIdTaken(tenantId, typedEmployeeId))) {
      throw employeeIdDuplicate(typedEmployeeId);
    }
    const staffRoleId = await this.repo.findTeacherRoleId(tenantId);
    if (staffRoleId === null) {
      throw new BusinessException(
        ErrorCode.ROLE_NOT_FOUND,
        'Teacher role not found for this institute',
      );
    }

    const suffix = crypto.randomUUID().slice(0, 12);
    const email = input.email ?? `staff-${suffix}@roviq.placeholder`;
    const username = `staff-${tenantId.slice(0, 8)}-${suffix}`;
    // Staff always get their own account: a typed number never links an existing one (SF-053).
    // It is stored as unverified contact data.
    const phone = input.phone ? { countryCode: '+91', number: input.phone } : undefined;

    const { userId: newUserId, tempPassword } = await this.identityService.createUser({
      email,
      username,
      phone,
      actorId,
      originTenantId: tenantId,
    });

    // The account is platform-level and written first; every institute row is one transaction.
    // A create refused there (a typed ID taken meanwhile) or failing removes the account again.
    const name = { firstName: input.firstName, lastName: input.lastName };
    let created: CreateStaffResult;
    try {
      await this.identityService.ensureUserProfile(newUserId, name, actorId);
      created = await this.repo.create({
        tenantId,
        userId: newUserId,
        roleId: staffRoleId,
        actorId,
        employeeId: typedEmployeeId,
        tenantProfile: { ...name, gender: input.gender, dateOfBirth: input.dateOfBirth },
        staff: {
          designation: input.designation ?? null,
          department: input.department ?? null,
          dateOfJoining: input.dateOfJoining ?? new Date().toISOString().split('T')[0],
          employmentType: input.employmentType ?? EmploymentType.REGULAR,
          specialization: input.specialization ?? null,
          socialCategory: input.socialCategory ?? null,
        },
      });
    } catch (error) {
      await this.discardAccount(newUserId);
      throw error;
    }
    if (created.kind === 'employee_id_taken') {
      await this.discardAccount(newUserId);
      // Only a typed ID is refused: a blank one moves on to the next value of the series.
      throw employeeIdDuplicate(typedEmployeeId ?? '');
    }
    const profile = created.row;

    this.eventBus.emit(EVENT_PATTERNS.STAFF.joined, {
      staffProfileId: profile.id,
      membershipId: profile.membershipId,
      department: input.department,
      tenantId,
    });

    this.signInDetails.sendOnCreate({
      tenantId,
      userId: newUserId,
      username,
      email: input.email,
      phone,
      firstName: englishOrFirst(input.firstName),
      lastName: englishOrFirst(input.lastName),
      tempPassword,
    });

    // Re-fetch via findById so the GraphQL StaffModel response includes the
    // joined name + photo from the institute's profile copy (StaffModel.firstName is now
    // i18nText and required).
    return this.findById(profile.id);
  }

  /** A failed create must not leave the account it made behind. */
  private async discardAccount(userId: string): Promise<void> {
    try {
      if (!(await this.identityService.discardNewUser(userId))) {
        this.logger.warn(`Kept account ${userId} of a failed staff create: it is in use`);
      }
    } catch (error) {
      this.logger.error(
        { err: error },
        `Could not remove account ${userId} of a failed staff create`,
      );
    }
  }

  /** New temporary password for a staff member of this institute who has not signed in yet. */
  async resendSignInDetails(id: string): Promise<boolean> {
    const tenantId = this.tenantId;
    const target = await this.repo.findSignInTarget(tenantId, id);
    if (!target)
      throw new BusinessException(ErrorCode.STAFF_NOT_FOUND, `Staff profile ${id} not found`);
    await this.signInDetails.resend(tenantId, target, this.userId);
    return true;
  }

  async update(id: string, input: UpdateStaffInput) {
    const tenantId = this.tenantId;
    const actorId = this.userId;

    const result = await this.repo.update({
      tenantId,
      id,
      actorId,
      version: input.version,
      staff: {
        ...(input.designation != null && { designation: input.designation }),
        ...(input.department != null && { department: input.department }),
        ...(input.employmentType != null && { employmentType: input.employmentType }),
        ...(input.isClassTeacher != null && { isClassTeacher: input.isClassTeacher }),
        ...(input.specialization != null && { specialization: input.specialization }),
        ...(input.socialCategory != null && { socialCategory: input.socialCategory }),
      },
      profile: {
        ...(input.firstName != null && { firstName: input.firstName }),
        ...(input.lastName !== undefined && { lastName: input.lastName }),
        ...(input.gender != null && { gender: input.gender }),
        ...(input.dateOfBirth != null && { dateOfBirth: input.dateOfBirth }),
      },
    });

    if (result.kind === 'not_found')
      throw new BusinessException(ErrorCode.STAFF_NOT_FOUND, `Staff profile ${id} not found`);
    if (result.kind === 'version_mismatch') {
      throw new BusinessException(
        ErrorCode.CONCURRENT_MODIFICATION,
        'Staff profile was modified by another request (version mismatch)',
      );
    }

    // Re-fetch via findById so the GraphQL response includes the joined
    // name + photo from the institute's profile copy.
    return this.findById(result.row.id);
  }

  async delete(id: string) {
    const tenantId = this.tenantId;
    const actorId = this.userId;
    const today = new Date().toISOString().split('T')[0];

    const deleted = await this.repo.softDelete(tenantId, id, actorId, today);
    if (deleted.kind === 'not_found')
      throw new BusinessException(ErrorCode.STAFF_NOT_FOUND, `Staff profile ${id} not found`);
    if (deleted.kind === 'own_membership') {
      throw new BusinessException(
        ErrorCode.CANNOT_REMOVE_OWN_MEMBERSHIP,
        'You cannot delete your own record: it would end your access to this institute',
      );
    }
    if (deleted.kind === 'needs_full_control') {
      throw new BusinessException(
        ErrorCode.FULL_CONTROL_REQUIRED,
        'Only a member with full control of the institute can remove or bring back this person',
      );
    }
    if (deleted.kind === 'last_admin') {
      throw new BusinessException(
        ErrorCode.LAST_ADMIN_CANNOT_BE_REMOVED,
        'This person is the only member with full control of the institute',
      );
    }

    this.eventBus.emit(EVENT_PATTERNS.STAFF.left, {
      staffProfileId: id,
      reason: deleted.row.leavingReason ?? 'deleted',
      tenantId,
    });

    return true;
  }

  async listDeleted() {
    return this.repo.listDeleted(this.tenantId);
  }

  async restore(id: string): Promise<boolean> {
    const tenantId = this.tenantId;
    const actorId = this.userId;

    const restored = await this.repo.restore(tenantId, id, actorId);
    if (restored === 'not_found') {
      throw new BusinessException(ErrorCode.STAFF_NOT_FOUND, 'Deleted staff member not found');
    }
    if (restored === 'needs_full_control') {
      throw new BusinessException(
        ErrorCode.FULL_CONTROL_REQUIRED,
        'Only a member with full control of the institute can remove or bring back this person',
      );
    }
    if (restored === 'employee_id_taken') {
      throw new BusinessException(
        ErrorCode.EMPLOYEE_ID_DUPLICATE,
        'A current staff member now has this employee ID; change theirs before restoring',
      );
    }

    this.eventBus.emit(EVENT_PATTERNS.STAFF.joined, { staffProfileId: id, tenantId });
    return true;
  }

  async statistics() {
    return this.repo.statistics(this.tenantId);
  }
}

function employeeIdDuplicate(employeeId: string): BusinessException {
  return new BusinessException(
    ErrorCode.EMPLOYEE_ID_DUPLICATE,
    `Employee ID ${employeeId} is already used by a current staff member`,
  );
}
