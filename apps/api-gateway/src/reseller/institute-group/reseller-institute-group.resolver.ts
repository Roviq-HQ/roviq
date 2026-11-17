import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { GqlAuthGuard, ResellerScopeGuard } from '@roviq/auth-backend';
import { AbilityGuard, CheckAbility } from '@roviq/casl';
import { CreateInstituteGroupInput } from '../../institute-group/dto/create-institute-group.input';
import { InstituteGroupModel } from '../../institute-group/models/institute-group.model';
import { InstituteGroupConnection } from '../../institute-group/models/institute-group-connection.model';
import { ResellerInstituteGroupService } from './reseller-institute-group.service';

@UseGuards(GqlAuthGuard, ResellerScopeGuard, AbilityGuard)
@Resolver(() => InstituteGroupModel)
export class ResellerInstituteGroupResolver {
  constructor(private readonly groupService: ResellerInstituteGroupService) {}

  @Mutation(() => InstituteGroupModel)
  @CheckAbility({ action: 'create', subject: 'InstituteGroup' })
  async resellerCreateInstituteGroup(@Args('input') input: CreateInstituteGroupInput) {
    return this.groupService.create(input);
  }

  @Query(() => InstituteGroupConnection)
  @CheckAbility({ action: 'read', subject: 'InstituteGroup' })
  async resellerListInstituteGroups() {
    return this.groupService.list();
  }
}
