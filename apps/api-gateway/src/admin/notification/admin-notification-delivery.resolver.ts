import { UseGuards } from '@nestjs/common';
import { Args, Int, Query, Resolver } from '@nestjs/graphql';
import {
  assertPlatformContext,
  CurrentUser,
  GqlAuthGuard,
  PlatformScopeGuard,
} from '@roviq/auth-backend';
import { AbilityGuard, CheckAbility } from '@roviq/casl';
import type { AuthUser } from '@roviq/common-types';
import {
  AdminNotificationDeliveryService,
  type NotificationDeliveryConnectionResult,
} from './admin-notification-delivery.service';
import {
  NotificationDeliveryConnection,
  NotificationDeliveryFilterInput,
  NotificationDeliveryModel,
} from './models/notification-delivery.model';

@UseGuards(GqlAuthGuard, PlatformScopeGuard, AbilityGuard)
@Resolver(() => NotificationDeliveryModel)
export class AdminNotificationDeliveryResolver {
  constructor(private readonly service: AdminNotificationDeliveryService) {}

  @Query(() => NotificationDeliveryConnection, {
    description: 'Platform support: every notification delivery attempt, newest first.',
  })
  @CheckAbility({ action: 'read', subject: 'NotificationDelivery' })
  adminNotificationDeliveries(
    @CurrentUser() user: AuthUser,
    @Args('filter', { type: () => NotificationDeliveryFilterInput, nullable: true })
    filter: NotificationDeliveryFilterInput | null,
    @Args('first', { type: () => Int, nullable: true, defaultValue: 20 }) first: number | null,
    @Args('after', { type: () => String, nullable: true }) after: string | null,
  ): Promise<NotificationDeliveryConnectionResult> {
    assertPlatformContext(user);
    return this.service.list(user, filter ?? {}, first, after);
  }
}
