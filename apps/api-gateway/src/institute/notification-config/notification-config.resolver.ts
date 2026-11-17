import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import {
  assertTenantContext,
  CurrentUser,
  GqlAuthGuard,
  InstituteScopeGuard,
} from '@roviq/auth-backend';
import { AbilityGuard, CheckAbility } from '@roviq/casl';
import type { AuthUser } from '@roviq/common-types';
import { UpdateNotificationConfigInput } from './dto/update-notification-config.input';
import { NotificationConfigModel } from './models/notification-config.model';
import { NotificationConfigService } from './notification-config.service';
import type { NotificationConfigRecord } from './repositories/types';

@UseGuards(GqlAuthGuard, InstituteScopeGuard, AbilityGuard)
@Resolver()
export class NotificationConfigResolver {
  constructor(private readonly notificationConfigService: NotificationConfigService) {}

  @Query(() => [NotificationConfigModel])
  @CheckAbility({ action: 'read', subject: 'Institute' })
  async notificationConfigs(): Promise<NotificationConfigRecord[]> {
    return this.notificationConfigService.findAll();
  }

  @Mutation(() => NotificationConfigModel)
  @CheckAbility({ action: 'update_config', subject: 'Institute' })
  async updateNotificationConfig(
    @Args('input') input: UpdateNotificationConfigInput,
    @CurrentUser() user: AuthUser,
  ): Promise<NotificationConfigRecord> {
    assertTenantContext(user);
    return this.notificationConfigService.update(user.tenantId, input);
  }

  @Mutation(() => Boolean)
  async registerDeviceToken(
    @Args('token') token: string,
    @CurrentUser() user: AuthUser,
  ): Promise<boolean> {
    return this.notificationConfigService.registerDeviceToken(user.userId, token);
  }
}
