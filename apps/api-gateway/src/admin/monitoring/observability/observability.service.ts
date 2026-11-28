import { Injectable } from '@nestjs/common';
import { BusinessException, ErrorCode } from '@roviq/common-types';
import { OpenObserveClient, OpenObserveUnavailableError } from '../openobserve.client';
import {
  areServiceNames,
  clampInt,
  logsSql,
  MAX_LOG_LINES,
  MAX_RANGE_SECONDS,
  MAX_TRACES,
  type MetricEndpoint,
  metricRange,
  tracesSql,
} from './observability-query';

export interface SearchInput {
  services?: string[] | null;
  limit?: number | null;
  sinceSeconds?: number | null;
}

export interface MetricsInput {
  endpoint: MetricEndpoint;
  query: string;
  step?: number | null;
  start?: number | null;
  end?: number | null;
}

/** What the alerts banner shows: a rule's owner, query and destinations stay on the server. */
export interface ObservabilityAlert {
  labels: Record<string, string>;
  annotations: Record<string, string>;
  state: 'firing';
  activeAt: string;
}

/**
 * Reads logs, traces, metrics and firing alerts from the telemetry store for the platform
 * admin's observability pages. The store's credential stays in this service.
 */
@Injectable()
export class ObservabilityService {
  constructor(private readonly openObserve: OpenObserveClient) {}

  logs(input: SearchInput): Promise<unknown> {
    const services = this.services(input);
    return this.read(() =>
      this.openObserve.search({
        type: 'logs',
        sql: logsSql(services),
        sinceSeconds: this.since(input),
        size: clampInt(input.limit, { fallback: 50, min: 1, max: MAX_LOG_LINES }),
      }),
    );
  }

  traces(input: SearchInput): Promise<unknown> {
    const services = this.services(input);
    return this.read(() =>
      this.openObserve.search({
        type: 'traces',
        sql: tracesSql(services),
        sinceSeconds: this.since(input),
        size: clampInt(input.limit, { fallback: 20, min: 1, max: MAX_TRACES }),
      }),
    );
  }

  metrics(input: MetricsInput): Promise<unknown> {
    if (input.query.trim().length === 0) {
      throw new BusinessException(ErrorCode.VALIDATION_FAILED, 'query required');
    }
    const params: Record<string, string> = { query: input.query };
    if (input.endpoint === 'query_range') {
      const range = metricRange(input, Math.floor(Date.now() / 1000));
      if (!range) throw new BusinessException(ErrorCode.VALIDATION_FAILED, 'start must be < end');
      params.step = String(range.step);
      params.start = String(range.start);
      params.end = String(range.end);
    }
    return this.read(() => this.openObserve.prometheus(input.endpoint, params));
  }

  async alerts(): Promise<{ status: 'success'; data: { alerts: ObservabilityAlert[] } }> {
    const firing = await this.read(() => this.openObserve.alerts());
    return {
      status: 'success',
      data: {
        alerts: firing.map((alert) => ({
          labels: alert.labels,
          annotations: alert.annotations,
          state: 'firing',
          activeAt: alert.activeAt,
        })),
      },
    };
  }

  private services(input: SearchInput): string[] {
    const names = (input.services ?? []).filter((name) => name.length > 0);
    if (!areServiceNames(names)) {
      throw new BusinessException(ErrorCode.VALIDATION_FAILED, 'invalid service name');
    }
    return names;
  }

  private since(input: SearchInput): number {
    return clampInt(input.sinceSeconds, { fallback: 3600, min: 1, max: MAX_RANGE_SECONDS });
  }

  private async read<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof OpenObserveUnavailableError) {
        throw new BusinessException(ErrorCode.OBSERVABILITY_UNAVAILABLE, err.message);
      }
      throw err;
    }
  }
}
