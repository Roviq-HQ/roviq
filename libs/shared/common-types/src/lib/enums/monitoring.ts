// ─── MonitoredService (ROV-184) ───────────────────────────────────────────────

export const MONITORED_SERVICE_VALUES = [
  // The api-gateway process itself — health measured by event-loop delay
  'API_GATEWAY',
  // Primary PostgreSQL database
  'POSTGRES',
  // Redis cache / session store
  'REDIS',
  // NATS JetStream event bus
  'NATS',
  // Temporal workflow engine
  'TEMPORAL',
  // S3-compatible object storage (both buckets reachable)
  'OBJECT_STORAGE',
] as const;

export type MonitoredService = (typeof MONITORED_SERVICE_VALUES)[number];

export const MonitoredService = Object.fromEntries(MONITORED_SERVICE_VALUES.map((v) => [v, v])) as {
  readonly [K in MonitoredService]: K;
};

// ─── ServiceHealthStatus ──────────────────────────────────────────────────────

export const SERVICE_HEALTH_STATUS_VALUES = [
  // Reachable and responding under its latency threshold
  'HEALTHY',
  // Reachable but responding slower than its latency threshold
  'DEGRADED',
  // Unreachable, erroring, or timed out
  'DOWN',
] as const;

export type ServiceHealthStatus = (typeof SERVICE_HEALTH_STATUS_VALUES)[number];

export const ServiceHealthStatus = Object.fromEntries(
  SERVICE_HEALTH_STATUS_VALUES.map((v) => [v, v]),
) as { readonly [K in ServiceHealthStatus]: K };

// ─── AlertSeverity ────────────────────────────────────────────────────────────

export const ALERT_SEVERITY_VALUES = [
  // Needs immediate action — user-facing outage or data at risk
  'CRITICAL',
  // Needs attention soon — degradation or a growing backlog
  'WARNING',
  // Informational — no action required
  'INFO',
] as const;

export type AlertSeverity = (typeof ALERT_SEVERITY_VALUES)[number];

export const AlertSeverity = Object.fromEntries(ALERT_SEVERITY_VALUES.map((v) => [v, v])) as {
  readonly [K in AlertSeverity]: K;
};
