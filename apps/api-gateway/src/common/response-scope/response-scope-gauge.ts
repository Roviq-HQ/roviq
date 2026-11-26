import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { metrics, type ObservableResult } from '@opentelemetry/api';

/** The span `api_foreign_scope_responses_recent` counts over. */
export const FOREIGN_SCOPE_WINDOW_MS = 15 * 60_000;
export const FOREIGN_SCOPE_METRIC = 'api_foreign_scope_responses_recent';

const SCOPES = ['institute', 'reseller'] as const;
export type CheckedScope = (typeof SCOPES)[number];

/**
 * `api_foreign_scope_responses_recent`: results in the last 15 minutes that carried another
 * institute's or reseller's id, per caller scope. A gauge of recent events, always reported
 * (0 included), so an alert on one event needs no counter increase.
 */
@Injectable()
export class ResponseScopeGauge implements OnModuleInit, OnModuleDestroy {
  private readonly gauge = metrics
    .getMeter('api-gateway')
    .createObservableGauge(FOREIGN_SCOPE_METRIC, {
      description: "Results in the last 15 minutes that carried an id outside the caller's scope",
    });
  private readonly events: Record<CheckedScope, number[]> = { institute: [], reseller: [] };

  onModuleInit(): void {
    this.gauge.addCallback(this.observe);
  }

  onModuleDestroy(): void {
    this.gauge.removeCallback(this.observe);
  }

  record(scope: CheckedScope, at: number = Date.now()): void {
    this.events[scope].push(at);
  }

  /** The count per scope at `now`; older events are dropped. */
  readings(now: number = Date.now()): Array<{ scope: CheckedScope; count: number }> {
    return SCOPES.map((scope) => {
      this.events[scope] = this.events[scope].filter((at) => now - at < FOREIGN_SCOPE_WINDOW_MS);
      return { scope, count: this.events[scope].length };
    });
  }

  private readonly observe = (result: ObservableResult): void => {
    for (const { scope, count } of this.readings()) result.observe(count, { scope });
  };
}
