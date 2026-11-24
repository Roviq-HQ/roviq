import { UseGuards } from '@nestjs/common';
import { Args, Int, Query, Resolver } from '@nestjs/graphql';
import {
  assertTenantContext,
  CurrentUser,
  GqlAuthGuard,
  InstituteScopeGuard,
} from '@roviq/auth-backend';
import { AbilityGuard, CheckAbility } from '@roviq/casl';
import type { AuthUser } from '@roviq/common-types';
import {
  NotificationDeliveryLogConnection,
  NotificationDeliveryLogEntry,
  NotificationDeliveryLogFilterInput,
} from './models/notification-delivery-log.model';
import {
  type NotificationDeliveryLogConnectionResult,
  NotificationDeliveryService,
} from './notification-delivery.service';

@UseGuards(GqlAuthGuard, InstituteScopeGuard, AbilityGuard)
@Resolver(() => NotificationDeliveryLogEntry)
export class NotificationDeliveryResolver {
  constructor(private readonly service: NotificationDeliveryService) {}

  @Query(() => NotificationDeliveryLogConnection, {
    description:
      "The institute's notifications sent outside the app: one entry per message and recipient with its state on each channel, newest activity first. `first` is capped at 100.",
  })
  @CheckAbility({ action: 'read', subject: 'NotificationDelivery' })
  notificationDeliveryLog(
    @CurrentUser() user: AuthUser,
    // Optional, not `| null`: a union emits no class metadata, and the input would go unvalidated.
    @Args('filter', { type: () => NotificationDeliveryLogFilterInput, nullable: true })
    filter?: NotificationDeliveryLogFilterInput,
    @Args('first', { type: () => Int, nullable: true, defaultValue: 25 }) first?: number,
    @Args('after', { type: () => String, nullable: true }) after?: string,
  ): Promise<NotificationDeliveryLogConnectionResult> {
    assertTenantContext(user);
    return this.service.log(user, filter ?? {}, first ?? null, after ?? null);
  }
}
