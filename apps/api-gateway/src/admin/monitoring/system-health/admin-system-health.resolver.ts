import { UseGuards } from '@nestjs/common';
import { Query, Resolver, Subscription } from '@nestjs/graphql';
import { GqlAuthGuard, PlatformScopeGuard } from '@roviq/auth-backend';
import { AbilityGuard, CheckAbility } from '@roviq/casl';
import type { ConnectionCounts } from '../connections/connection-tracker';
import { ConnectionStatsModel, SystemHealthModel } from './models/system-health.model';
import {
  type SystemHealth,
  SystemHealthService,
  type SystemHealthUpdatedPayload,
} from './system-health.service';

@UseGuards(GqlAuthGuard, PlatformScopeGuard, AbilityGuard)
@Resolver(() => SystemHealthModel)
export class AdminSystemHealthResolver {
  constructor(private readonly systemHealth: SystemHealthService) {}

  @Query(() => SystemHealthModel, {
    description:
      'Platform admin: status of every platform dependency, stream lag, alerts (ROV-184)',
  })
  @CheckAbility({ action: 'read', subject: 'SystemHealth' })
  adminSystemHealth(): Promise<SystemHealth> {
    return this.systemHealth.getSystemHealth();
  }

  @Query(() => ConnectionStatsModel, {
    description: 'Platform admin: live connections on the answering api-gateway instance',
  })
  @CheckAbility({ action: 'read', subject: 'SystemHealth' })
  adminConnectionMetrics(): ConnectionCounts {
    return this.systemHealth.getConnectionStats();
  }

  @Subscription(() => SystemHealthModel, {
    description:
      'Platform admin: the current snapshot on subscribe, then a new one whenever a service status, stream lag, the alert set or the DLQ count changes',
    resolve: (payload: SystemHealthUpdatedPayload) => payload.adminSystemHealthUpdated,
  })
  @CheckAbility({ action: 'read', subject: 'SystemHealth' })
  adminSystemHealthUpdated(): AsyncGenerator<SystemHealthUpdatedPayload> {
    return this.systemHealth.watch();
  }
}
