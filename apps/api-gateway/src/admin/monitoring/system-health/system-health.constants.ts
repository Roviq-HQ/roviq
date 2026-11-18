import type { MonitoredService } from '@roviq/common-types';

export const SYSTEM_HEALTH_POLL_INTERVAL_MS = 15_000;

/** A reachable service answering slower than this is DEGRADED. API_GATEWAY compares event-loop delay p99. */
export const DEGRADED_THRESHOLD_MS: Record<MonitoredService, number> = {
  API_GATEWAY: 200,
  POSTGRES: 500,
  REDIS: 100,
  NATS: 200,
  TEMPORAL: 1_000,
  MINIO: 1_000,
};

export const UPTIME_BUCKET_SECONDS = 3_600;
export const UPTIME_WINDOW_BUCKETS = 24;
/** One bucket longer than the window so the oldest bucket read is never already expired. */
export const UPTIME_BUCKET_TTL_SECONDS = UPTIME_BUCKET_SECONDS * (UPTIME_WINDOW_BUCKETS + 1);

// In-process GraphQL topic only — never published to NATS, so it is not in EVENT_PATTERNS.
export const SYSTEM_HEALTH_UPDATED_TOPIC = 'MONITORING.system_health_updated';
