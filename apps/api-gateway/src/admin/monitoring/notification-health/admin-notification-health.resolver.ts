import { UseGuards } from '@nestjs/common';
import { Query, Resolver } from '@nestjs/graphql';
import {
  assertPlatformContext,
  CurrentUser,
  GqlAuthGuard,
  PlatformScopeGuard,
} from '@roviq/auth-backend';
import { AbilityGuard, CheckAbility } from '@roviq/casl';
import type { AuthUser } from '@roviq/common-types';
import { NotificationHealthModel } from './models/notification-health.model';
import { NotificationHealthService } from './notification-health.service';

@UseGuards(GqlAuthGuard, PlatformScopeGuard, AbilityGuard)
@Resolver()
export class AdminNotificationHealthResolver {
  constructor(private readonly service: NotificationHealthService) {}

  @Query(() => NotificationHealthModel, {
    description:
      'Platform admin: sends and failures per channel in the last 24 hours and the delivery canary (ROV-329)',
  })
  @CheckAbility({ action: 'read', subject: 'SystemHealth' })
  adminNotificationHealth(@CurrentUser() user: AuthUser): Promise<NotificationHealthModel> {
    assertPlatformContext(user);
    return this.service.get(user);
  }
}
