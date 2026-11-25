/**
 * Where the first step of each alert is taken. The copy (title, impact, steps) lives in
 * `messages/{en,hi}/adminMonitoring.json` → `alerts.rules.<rule name>`; the full procedure stays
 * in the rule's runbook section.
 */
export type AlertTarget =
  | 'notifications'
  | 'senders'
  | 'services'
  | 'streams'
  | 'dlq'
  | 'logs'
  | 'auditLogs'
  | 'impersonation';

/** Scope-relative paths; the locale is prefixed where they are used. */
export const ALERT_TARGET_PATH: Record<AlertTarget, string> = {
  notifications: '/admin/monitoring#notification-delivery',
  senders: '/admin/monitoring#notification-senders-heading',
  services: '/admin/monitoring#monitoring-services-heading',
  streams: '/admin/monitoring#event-streams',
  dlq: '/admin/observability?tab=dlq',
  logs: '/admin/observability?tab=traces-logs',
  auditLogs: '/admin/audit-logs',
  impersonation: '/admin/impersonation-sessions',
};

/** One entry for each rule file in `docker/openobserve/alerts/` (a unit test keeps them equal). */
export const ALERT_TARGET: Record<string, AlertTarget> = {
  audit_consumer_lag: 'streams',
  audit_dlq_depth: 'dlq',
  audit_event_spike: 'auditLogs',
  audit_impersonation_volume: 'impersonation',
  audit_partition_creation: 'logs',
  dlq_messages_critical: 'dlq',
  dlq_messages_warning: 'dlq',
  eventbus_emit_failures_critical: 'services',
  eventbus_emit_failures_warning: 'services',
  notification_breaker_opened: 'notifications',
  notification_canary_missing: 'notifications',
  notification_dead_letters: 'dlq',
  notification_events_stuck: 'streams',
  notification_failure_rate: 'notifications',
  notification_sender_blocked: 'senders',
  notification_service_down: 'services',
  notification_skips_rising: 'notifications',
};

/** The repository is public; a runbook label is a path in it with an anchor. */
export const RUNBOOK_BASE_URL = 'https://github.com/Roviq-HQ/roviq/blob/main/';

export function runbookUrl(runbook: string | null | undefined): string | null {
  if (!runbook || !/^docs\/[a-z0-9/-]+\.md(#[a-z0-9-]+)?$/.test(runbook)) return null;
  return `${RUNBOOK_BASE_URL}${runbook}`;
}
