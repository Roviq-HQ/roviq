import { UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Parent, Query, ResolveField, Resolver } from '@nestjs/graphql';
import { CurrentUser, GqlAuthGuard, PlatformScopeGuard } from '@roviq/auth-backend';
import { AbilityGuard, CheckAbility } from '@roviq/casl';
import type { AuthUser } from '@roviq/common-types';
import type { I18nContent } from '@roviq/database';
import { I18nTextScalar } from '@roviq/nestjs-graphql';
import { DlqService } from '../../dlq/dlq.service';
import {
  DlqMessageConnection,
  DlqMessageFilterInput,
  DlqMessageModel,
} from '../../dlq/models/dlq-message.model';
import { DlqInstituteNameLoader } from './dlq-institute-name.loader';

@UseGuards(GqlAuthGuard, PlatformScopeGuard, AbilityGuard)
@Resolver(() => DlqMessageModel)
export class AdminDlqResolver {
  constructor(
    private readonly dlq: DlqService,
    private readonly instituteNames: DlqInstituteNameLoader,
  ) {}

  @ResolveField(() => I18nTextScalar, {
    nullable: true,
    description:
      'Name (i18n) of the institute the message belonged to; null for a cross-institute message or a deleted institute',
  })
  tenantName(@Parent() message: DlqMessageModel): Promise<I18nContent | null> | null {
    return message.tenantId ? this.instituteNames.byId.load(message.tenantId) : null;
  }

  @Query(() => DlqMessageConnection, {
    description: 'Platform admin: list dead-lettered NATS messages (ROV-19)',
  })
  @CheckAbility({ action: 'read', subject: 'DlqMessage' })
  async adminListDlqMessages(@Args('filter', { nullable: true }) filter?: DlqMessageFilterInput) {
    return this.dlq.list(filter ?? {});
  }

  @Mutation(() => DlqMessageModel, {
    description: 'Re-publish a dead-lettered message to its original subject',
  })
  @CheckAbility({ action: 'replay', subject: 'DlqMessage' })
  async adminReplayDlqMessage(
    @Args('id', { type: () => ID }) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.dlq.replay(id, user.userId);
  }

  @Mutation(() => DlqMessageModel, {
    description: 'Discard a dead-lettered message without replaying it',
  })
  @CheckAbility({ action: 'replay', subject: 'DlqMessage' })
  async adminDiscardDlqMessage(@Args('id', { type: () => ID }) id: string) {
    return this.dlq.discard(id);
  }
}
