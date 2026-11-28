import { UseGuards } from '@nestjs/common';
import { Args, Int, Query, Resolver } from '@nestjs/graphql';
import { GqlAuthGuard, PlatformScopeGuard } from '@roviq/auth-backend';
import { AbilityGuard, CheckAbility } from '@roviq/casl';
import { BusinessException, ErrorCode } from '@roviq/common-types';
import GraphQLJSON from 'graphql-type-json';
import { ObservabilityService } from './observability.service';
import { METRIC_ENDPOINTS, type MetricEndpoint } from './observability-query';

const SERVICES = {
  type: () => [String],
  nullable: true,
  description: 'Service names to keep (letters, digits, dot, dash, underscore). Empty: all.',
} as const;
const SINCE = {
  type: () => Int,
  nullable: true,
  description: 'How far back to read, in seconds. Default 3600, at most 30 days.',
} as const;

@UseGuards(GqlAuthGuard, PlatformScopeGuard, AbilityGuard)
@Resolver()
export class AdminObservabilityResolver {
  constructor(private readonly observability: ObservabilityService) {}

  @Query(() => GraphQLJSON, {
    description:
      'Platform admin: recent log lines from the telemetry store, newest first, as `{ hits: [{ _timestamp, severity, service_name, body }] }`.',
  })
  @CheckAbility({ action: 'read', subject: 'SystemHealth' })
  adminObservabilityLogs(
    @Args('services', SERVICES) services?: string[],
    @Args('limit', { type: () => Int, nullable: true, description: 'Default 50, at most 500.' })
    limit?: number,
    @Args('sinceSeconds', SINCE) sinceSeconds?: number,
  ): Promise<unknown> {
    return this.observability.logs({ services, limit, sinceSeconds });
  }

  @Query(() => GraphQLJSON, {
    description:
      'Platform admin: recent root spans, newest first, as `{ hits: [{ _timestamp, trace_id, service_name, operation_name, duration }] }`.',
  })
  @CheckAbility({ action: 'read', subject: 'SystemHealth' })
  adminObservabilityTraces(
    @Args('services', SERVICES) services?: string[],
    @Args('limit', { type: () => Int, nullable: true, description: 'Default 20, at most 100.' })
    limit?: number,
    @Args('sinceSeconds', SINCE) sinceSeconds?: number,
  ): Promise<unknown> {
    return this.observability.traces({ services, limit, sinceSeconds });
  }

  @Query(() => GraphQLJSON, {
    description:
      'Platform admin: one PromQL query against the telemetry store; answers the Prometheus response envelope `{ status, data }`.',
  })
  @CheckAbility({ action: 'read', subject: 'SystemHealth' })
  adminObservabilityMetrics(
    @Args('query', { description: 'PromQL expression.' }) query: string,
    @Args('endpoint', {
      type: () => String,
      nullable: true,
      description: '`query` (instant) or `query_range` (default).',
    })
    endpoint?: string,
    @Args('step', {
      type: () => Int,
      nullable: true,
      description: 'Seconds between points of a range query. Default 30, from 5 to 86400.',
    })
    step?: number,
    @Args('start', {
      type: () => Int,
      nullable: true,
      description: 'Range start, unix seconds. Default one hour ago; at most 30 days before `end`.',
    })
    start?: number,
    @Args('end', {
      type: () => Int,
      nullable: true,
      description: 'Range end, unix seconds. Default now.',
    })
    end?: number,
  ): Promise<unknown> {
    return this.observability.metrics({
      endpoint: metricEndpoint(endpoint),
      query,
      step,
      start,
      end,
    });
  }

  @Query(() => GraphQLJSON, {
    description:
      'Platform admin: alert rules that are firing, as `{ status, data: { alerts: [{ labels, annotations, state, activeAt }] } }`.',
  })
  @CheckAbility({ action: 'read', subject: 'SystemHealth' })
  adminObservabilityAlerts(): Promise<unknown> {
    return this.observability.alerts();
  }
}

function metricEndpoint(raw: string | undefined): MetricEndpoint {
  const found = METRIC_ENDPOINTS.find((endpoint) => endpoint === (raw ?? 'query_range'));
  if (!found) {
    throw new BusinessException(
      ErrorCode.VALIDATION_FAILED,
      `endpoint must be one of ${METRIC_ENDPOINTS.join(', ')}`,
    );
  }
  return found;
}
