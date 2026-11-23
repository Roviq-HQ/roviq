/**
 * Staff service (ROV-157).
 *
 * Handles staff CRUD, employee_id generation, and NATS events.
 * Queries live in `StaffRepository`, which runs them under the institute's RLS context.
 */

import { Injectable } from '@nestjs/common';
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

@Injectable()
export class StaffService {
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
    });
    const newUser = { id: newUserId };

    await this.identityService.ensureUserProfile(
      newUser.id,
      { firstName: input.firstName, lastName: input.lastName },
      actorId,
    );

    const staffRoleId = await this.repo.findTeacherRoleId(tenantId);

    if (staffRoleId === null)
      throw new BusinessException(
        ErrorCode.ROLE_NOT_FOUND,
        'Teacher role not found for this institute',
      );

    const newMembership = await this.repo.createMembership({
      tenantId,
      userId: newUser.id,
      roleId: staffRoleId,
      actorId,
      profile: {
        firstName: input.firstName,
        lastName: input.lastName,
        gender: input.gender,
        dateOfBirth: input.dateOfBirth,
      },
    });

    const employeeId = await this.repo.nextEmployeeId(tenantId);

    const profile = await this.repo.createProfile({
      tenantId,
      userId: newUser.id,
      membershipId: newMembership.id,
      employeeId,
      designation: input.designation ?? null,
      department: input.department ?? null,
      dateOfJoining: input.dateOfJoining ?? new Date().toISOString().split('T')[0],
      employmentType: input.employmentType ?? EmploymentType.REGULAR,
      specialization: input.specialization ?? null,
      actorId,
    });

    this.eventBus.emit(EVENT_PATTERNS.STAFF.joined, {
      staffProfileId: profile.id,
      membershipId: newMembership.id,
      department: input.department,
      tenantId,
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

    // Re-fetch via findById so the GraphQL StaffModel response includes the
    // joined name + photo from the institute's profile copy (StaffModel.firstName is now
    // i18nText and required).
    return this.findById(profile.id);
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
    if (!deleted)
      throw new BusinessException(ErrorCode.STAFF_NOT_FOUND, `Staff profile ${id} not found`);

    this.eventBus.emit(EVENT_PATTERNS.STAFF.left, {
      staffProfileId: id,
      reason: deleted.leavingReason ?? 'deleted',
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
    if (!restored) {
      throw new BusinessException(ErrorCode.STAFF_NOT_FOUND, 'Deleted staff member not found');
    }

    this.eventBus.emit(EVENT_PATTERNS.STAFF.joined, { staffProfileId: id, tenantId });
    return true;
  }

  async statistics() {
    return this.repo.statistics(this.tenantId);
  }
}
