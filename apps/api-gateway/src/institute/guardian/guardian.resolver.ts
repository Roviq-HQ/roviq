import { UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { GqlAuthGuard, InstituteScopeGuard } from '@roviq/auth-backend';
import {
  AbilityGuard,
  CheckAbility,
  CurrentReadAccess,
  type InstituteReadAccess,
} from '@roviq/casl';
import { DeletedPersonModel } from '../../common/deleted-person.model';
import { CreateGuardianInput } from './dto/create-guardian.input';
import {
  LinkGuardianInput,
  RevokeGuardianAccessInput,
  UnlinkGuardianInput,
} from './dto/link-guardian.input';
import { ListGuardiansFilterInput } from './dto/list-guardians-filter.input';
import { UpdateGuardianInput } from './dto/update-guardian.input';
import { GuardianService } from './guardian.service';
import { GuardianQueryService } from './guardian-query.service';
import {
  GuardianLinkedStudentModel,
  GuardianLinkModel,
  GuardianModel,
  StudentGuardianModel,
} from './models/guardian.model';

@UseGuards(GqlAuthGuard, InstituteScopeGuard, AbilityGuard)
@Resolver(() => GuardianModel)
export class GuardianResolver {
  constructor(
    private readonly guardianService: GuardianService,
    private readonly queries: GuardianQueryService,
  ) {}

  @Query(() => [GuardianModel], {
    description: 'List all guardians in this institute, with optional free-text search',
  })
  @CheckAbility({ action: 'read', subject: 'Guardian', rows: 'scoped' })
  async listGuardians(
    @CurrentReadAccess() access: InstituteReadAccess,
    @Args('filter', { nullable: true }) filter?: ListGuardiansFilterInput,
  ): Promise<GuardianModel[]> {
    return this.queries.list(filter ?? {}, access);
  }

  @Query(() => [GuardianLinkedStudentModel], {
    description:
      'List students linked to a single guardian, with resolved class/section + link metadata. Used by the Linked Children tab on the guardian detail page.',
  })
  @CheckAbility({ action: 'read', subject: 'Guardian', rows: 'scoped' })
  async listLinkedStudents(
    @Args('guardianProfileId', { type: () => ID }) guardianProfileId: string,
    @CurrentReadAccess() access: InstituteReadAccess,
  ): Promise<GuardianLinkedStudentModel[]> {
    return this.queries.listLinkedStudents(guardianProfileId, access);
  }

  @Query(() => [StudentGuardianModel], {
    description:
      'List guardians linked to a single student, with relationship and contact metadata. Used by the Guardians tab on the student detail page.',
  })
  @CheckAbility({ action: 'read', subject: 'Guardian', rows: 'scoped' })
  async listStudentGuardians(
    @Args('studentProfileId', { type: () => ID }) studentProfileId: string,
    @CurrentReadAccess() access: InstituteReadAccess,
  ): Promise<StudentGuardianModel[]> {
    return this.queries.listForStudent(studentProfileId, access);
  }

  @Query(() => GuardianModel, { description: 'Get a guardian by ID' })
  @CheckAbility({ action: 'read', subject: 'Guardian', rows: 'scoped' })
  async getGuardian(
    @Args('id', { type: () => ID }) id: string,
    @CurrentReadAccess() access: InstituteReadAccess,
  ): Promise<GuardianModel> {
    return this.queries.findById(id, access);
  }

  @Mutation(() => GuardianModel, { description: 'Create guardian, optionally link to a student' })
  @CheckAbility({ action: 'create', subject: 'Guardian' })
  async createGuardian(@Args('input') input: CreateGuardianInput): Promise<GuardianModel> {
    return this.guardianService.create(input) as Promise<GuardianModel>;
  }

  @Mutation(() => GuardianModel, { description: 'Update guardian with optimistic concurrency' })
  @CheckAbility({ action: 'update', subject: 'Guardian' })
  async updateGuardian(
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: UpdateGuardianInput,
  ): Promise<GuardianModel> {
    return this.guardianService.update(id, input) as Promise<GuardianModel>;
  }

  @Mutation(() => Boolean, {
    description:
      'Send a guardian a new temporary password with their username, by email and SMS. Only before their first sign-in; at most once a minute and five times a day per person.',
  })
  @CheckAbility({ action: 'update', subject: 'Guardian' })
  async resendGuardianSignInDetails(
    @Args('guardianProfileId', { type: () => ID }) guardianProfileId: string,
  ): Promise<boolean> {
    return this.guardianService.resendSignInDetails(guardianProfileId);
  }

  @Mutation(() => Boolean, { description: 'Soft-delete a guardian' })
  @CheckAbility({ action: 'delete', subject: 'Guardian' })
  async deleteGuardian(@Args('id', { type: () => ID }) id: string): Promise<boolean> {
    return this.guardianService.delete(id);
  }

  @Query(() => [DeletedPersonModel], {
    description: 'Soft-deleted guardians of this institute, most recently deleted first.',
  })
  @CheckAbility({ action: 'restore', subject: 'Guardian' })
  async listDeletedGuardians(): Promise<DeletedPersonModel[]> {
    return this.guardianService.listDeleted();
  }

  @Mutation(() => Boolean, { description: 'Restore a soft-deleted guardian.' })
  @CheckAbility({ action: 'restore', subject: 'Guardian' })
  async restoreGuardian(@Args('id', { type: () => ID }) id: string): Promise<boolean> {
    return this.guardianService.restore(id);
  }

  @Mutation(() => GuardianLinkModel, { description: 'Link a guardian to a student' })
  @CheckAbility({ action: 'create', subject: 'Guardian' })
  async linkGuardianToStudent(@Args('input') input: LinkGuardianInput): Promise<GuardianLinkModel> {
    return this.guardianService.linkToStudent(input) as Promise<GuardianLinkModel>;
  }

  @Mutation(() => Boolean, {
    description: 'Unlink a guardian from a student. If primary, must provide newPrimaryGuardianId',
  })
  @CheckAbility({ action: 'delete', subject: 'Guardian' })
  async unlinkGuardianFromStudent(@Args('input') input: UnlinkGuardianInput): Promise<boolean> {
    return this.guardianService.unlinkFromStudent(input);
  }

  @Mutation(() => GuardianLinkModel, {
    description:
      'Revoke guardian access (divorce/separation). Sets can_pickup=false, preserves link for TC history.',
  })
  @CheckAbility({ action: 'manage', subject: 'Guardian' })
  async revokeGuardianAccess(
    @Args('input') input: RevokeGuardianAccessInput,
  ): Promise<GuardianLinkModel> {
    return this.guardianService.revokeAccess(input) as Promise<GuardianLinkModel>;
  }
}
