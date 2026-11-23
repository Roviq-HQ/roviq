import { Field, Float, Int, ObjectType, registerEnumType } from '@nestjs/graphql';
import { AlertSeverity, MonitoredService, ServiceHealthStatus } from '@roviq/common-types';
import { DateTimeScalar } from '@roviq/nestjs-graphql';

registerEnumType(MonitoredService, {
  name: 'MonitoredService',
  description: 'Platform dependency watched by the system health poller',
});
registerEnumType(ServiceHealthStatus, {
  name: 'ServiceHealthStatus',
  description:
    'HEALTHY = under latency threshold; DEGRADED = reachable but slow; DOWN = unreachable',
});
registerEnumType(AlertSeverity, {
  name: 'AlertSeverity',
  description: 'Severity label of a firing alert',
});

@ObjectType('ServiceHealth', {
  description: 'Latest health check result for one platform dependency',
})
export class ServiceHealthModel {
  @Field(() => MonitoredService)
  name!: MonitoredService;

  @Field(() => ServiceHealthStatus)
  status!: ServiceHealthStatus;

  @Field(() => Float, {
    nullable: true,
    description:
      'Check round-trip in milliseconds (API_GATEWAY: event-loop delay p99); null when DOWN',
  })
  responseMs!: number | null;

  @Field(() => Float, {
    nullable: true,
    description:
      'Share of successful checks over the rolling last 24 hours (0–100); null until the first sample',
  })
  uptimePercent!: number | null;

  @Field(() => DateTimeScalar)
  checkedAt!: Date;
}

@ObjectType('NatsStreamLag', { description: 'Backlog of one JetStream stream' })
export class NatsStreamLagModel {
  @Field()
  name!: string;

  @Field(() => Int, {
    description: 'Sum of pending (undelivered) messages over all consumers of the stream',
  })
  consumerLag!: number;
}

@ObjectType('ConnectionStats', {
  description: 'Live connections held by this api-gateway instance',
})
export class ConnectionStatsModel {
  @Field(() => Int, { description: 'Open graphql-ws subscription connections' })
  websocket!: number;

  @Field(() => Int, { description: 'HTTP requests currently in flight' })
  http!: number;
}

@ObjectType('ActiveAlert', { description: 'A firing OpenObserve alert' })
export class ActiveAlertModel {
  @Field({ description: 'Alert name' })
  name!: string;

  @Field(() => AlertSeverity)
  severity!: AlertSeverity;

  @Field({ description: 'Alert summary (falls back to description, then the alert name)' })
  message!: string;

  @Field(() => DateTimeScalar, { description: 'When the alert became active' })
  since!: Date;
}

@ObjectType('SystemHealth', { description: 'Platform-wide health snapshot (ROV-184)' })
export class SystemHealthModel {
  @Field(() => [ServiceHealthModel], {
    description: 'Always all six services, in MonitoredService order',
  })
  services!: ServiceHealthModel[];

  @Field(() => [NatsStreamLagModel])
  natsStreams!: NatsStreamLagModel[];

  @Field(() => ConnectionStatsModel)
  connections!: ConnectionStatsModel;

  @Field(() => [ActiveAlertModel], { description: 'Firing alerts only' })
  alerts!: ActiveAlertModel[];

  @Field({
    description: 'False when OpenObserve is unreachable — `alerts` is then empty, not "all clear"',
  })
  alertsAvailable!: boolean;

  @Field(() => Int, { description: 'Dead-lettered messages awaiting admin action' })
  dlqPendingCount!: number;

  @Field(() => DateTimeScalar)
  checkedAt!: Date;
}
