# DLQ message spike

## Symptom

Grafana alert `DlqMessagesWarning` (or `…Critical`) firing — sustained
`roviq_nats_dlq_messages_total` rate above threshold for one or more
`origin_stream` labels.

User-facing impact depends on which stream is dead-lettering — if it's
`NOTIFICATION.*` an institute's users miss notifications; if `BILLING.*`
payment-state side effects didn't run; if `AUDIT.*` audit rows are
delayed until replay.

## What it means

A message from `origin_stream` exhausted its JetStream delivery retries
and was persisted to the `dlq_messages` table by the DLQ reader instead
of being dropped. Each dead-lettered message increments
`nats_dlq_messages_total` (label `origin_stream`). The row is durable —
nothing is lost; it waits for inspection and replay.

Causes, in rough order of likelihood:

1. **Downstream dependency down** — e.g. the Novu circuit breaker is
   open, so every notification handler invocation fails until retries
   are exhausted. Check the `circuit_breaker_state` gauge.
2. **Bad payload** — a malformed or schema-incompatible event the
   handler can't process; it fails deterministically on every retry.
3. **Bug in the handler** — a code path that throws for a specific
   message shape; will keep dead-lettering until the fix ships.

## Investigate

1. Open the admin observability dashboard → **Dead Letter Queue** tab.
2. Filter by the failing `origin_stream`.
3. Inspect each row's **payload** and **error** to identify the cause.
4. Correlate with `circuit_breaker_state` — if a breaker is open, the
   dead-letters are a symptom of the downstream outage, not a payload
   or handler bug.

## Remediation

- **Fix the root cause first.** If a dependency is down, restore it and
  confirm `circuit_breaker_state` returns to closed. If it's a bad
  payload or handler bug, ship the fix before replaying.
- **Replay** actionable messages from the admin Dead Letter Queue tab
  once the root cause is fixed — the message is re-published to its
  origin stream and re-processed.
- **Discard** messages that are not actionable (e.g. a payload for a
  deleted institute, or an event that is no longer meaningful).

## After the incident

1. Confirm `roviq_nats_dlq_messages_total` rate has returned to baseline
   and the DLQ tab is drained for the affected `origin_stream`.
2. If the cause was a recurring payload/handler bug, file a follow-up PR
   to make it impossible (validation, type tightening).
3. Append to `docs/changelogs/testing-troubleshooting.md` with date,
   trigger, root cause, fix.

## Related

- Alert rule: `docs/observability/alerts/dlq-messages.yaml`
- Linear: ROV-19
