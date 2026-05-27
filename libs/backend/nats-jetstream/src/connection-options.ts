import type { ConnectionOptions } from '@nats-io/nats-core';

/**
 * Resilient NATS connection defaults shared by the JetStream client and server.
 *
 * Root cause this fixes: `connect()` rejects on the first ECONNREFUSED, which
 * propagates out of NestJS bootstrap and exits the process — and under
 * `nx serve` the process then sits idle "waiting for changes", so a brief NATS
 * unavailability at startup (parallel boot under Tilt/compose/k8s, a NATS
 * restart, a slow port-forward) permanently downs the gateway until someone
 * manually re-triggers it.
 *
 * With these options the connection waits for NATS instead of crashing, and
 * reconnects on its own when NATS comes back — the service self-heals:
 *
 * - `waitOnFirstConnect`: don't reject if NATS isn't accepting yet; keep
 *   trying using the reconnect settings below.
 * - `reconnect` + `maxReconnectAttempts: -1`: retry forever. NATS is a hard
 *   dependency; the correct degradation is "stay not-ready and keep trying",
 *   not "exit". In k8s this keeps the pod un-ready (no traffic) until the bus
 *   is reachable, which is the desired behaviour.
 * - `reconnectTimeWait`: 1s between attempts — snappy enough for local dev,
 *   gentle enough for prod.
 */
export const RESILIENT_NATS_OPTIONS: Partial<ConnectionOptions> = {
  waitOnFirstConnect: true,
  reconnect: true,
  maxReconnectAttempts: -1,
  reconnectTimeWait: 1000,
};
