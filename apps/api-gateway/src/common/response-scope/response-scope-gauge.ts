import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { metrics, type ObservableResult } from '@opentelemetry/api';

/** The span `api_foreign_scope_responses_recent` counts over. */
export const FOREIGN_SCOPE_WINDOW_MS = 15 * 60_000;
export const FOREIGN_SCOPE_METRIC = 'api_foreign_scope_responses_recent';

const SCOPES = ['institute', 'reseller'] as const;
export type CheckedScope = (typeof SCOPES)[number];

/** `foreign_id`: an id that is not the caller's. `too_large`: a value too large to read in full. */
const REASONS = ['foreign_id', 'too_large'] as const;
export type FailedCheckReason = (typeof REASONS)[number];

export interface ScopeReading {
  scope: CheckedScope;
  reason: FailedCheckReason;
  count: number;
}

/**
 * `api_foreign_scope_responses_recent`: responses in the last 15 minutes that failed the scope
 * check, per caller scope and reason. A gauge of recent events, always reported (0 included),
 * so an alert on one event needs no counter increase.
 */
@Injectable()
export class ResponseScopeGauge implements OnModuleInit, OnModuleDestroy {
  private readonly gauge = metrics
    .getMeter('api-gateway')
    .createObservableGauge(FOREIGN_SCOPE_METRIC, {
      description: 'Responses in the last 15 minutes that failed the scope check',
    });
  private events: Array<{ scope: CheckedScope; reason: FailedCheckReason; at: number }> = [];

  onModuleInit(): void {
    this.gauge.addCallback(this.observe);
  }

  onModuleDestroy(): void {
    this.gauge.removeCallback(this.observe);
  }

  record(scope: CheckedScope, reason: FailedCheckReason, at: number = Date.now()): void {
    this.events.push({ scope, reason, at });
  }

  /** The count per scope and reason at `now`; older events are dropped. */
  readings(now: number = Date.now()): ScopeReading[] {
    this.events = this.events.filter((event) => now - event.at < FOREIGN_SCOPE_WINDOW_MS);
    return SCOPES.flatMap((scope) =>
      REASONS.map((reason) => ({
        scope,
        reason,
        count: this.events.filter((e) => e.scope === scope && e.reason === reason).length,
      })),
    );
  }

  private readonly observe = (result: ObservableResult): void => {
    for (const { scope, reason, count } of this.readings()) {
      result.observe(count, { scope, reason });
    }
  };
}
