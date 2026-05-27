import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { CurrentUser, PlatformScope } from '@roviq/auth-backend';
import { CheckAbility } from '@roviq/casl';
import type { AuthUser } from '@roviq/common-types';
import { DlqService } from './dlq.service';
import {
  DlqMessageConnection,
  DlqMessageFilterInput,
  DlqMessageModel,
} from './models/dlq-message.model';

@PlatformScope()
@Resolver(() => DlqMessageModel)
export class DlqResolver {
  constructor(private readonly dlq: DlqService) {}

  @Query(() => DlqMessageConnection, {
    description: 'Platform admin: list dead-lettered NATS messages (ROV-19)',
  })
  @CheckAbility('read', 'DlqMessage')
  async adminListDlqMessages(@Args('filter', { nullable: true }) filter?: DlqMessageFilterInput) {
    return this.dlq.list(filter ?? {});
  }

  @Mutation(() => DlqMessageModel, {
    description: 'Re-publish a dead-lettered message to its original subject',
  })
  @CheckAbility('replay', 'DlqMessage')
  async replayDlqMessage(
    @Args('id', { type: () => ID }) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.dlq.replay(id, user.userId);
  }

  @Mutation(() => DlqMessageModel, {
    description: 'Discard a dead-lettered message without replaying it',
  })
  @CheckAbility('replay', 'DlqMessage')
  async discardDlqMessage(@Args('id', { type: () => ID }) id: string) {
    return this.dlq.discard(id);
  }
}
