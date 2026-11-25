# Notification delivery alerts

The notification service measures its own delivery and sends a test message (the canary) every
15 minutes (`docs/architecture.md` → "Notifications"). Ten OpenObserve alerts in
`docker/openobserve/alerts/notification_*.json` watch it; the metrics they read are listed in
`docs/infrastructure.md` → "Observability". Each section below is what to check first when one
fires. `page` alerts mean messages are not reaching people now; `ticket` alerts can wait for
working hours.

The admin portal's Monitoring page shows the sends and failures per channel for the last 24
hours, the canary's last success per channel and the WhatsApp senders' status.

## Service down

`notification_service_down` (page): no notification service reported a running Temporal worker
for 2 minutes, or one reported that its worker stopped.

1. `GET /health` on each notification service: `notificationWorker.state` says `stopped` or the
   call does not answer.
2. The service's log: `Notification worker failed to start` or `stopped with an error` names the
   cause; it retries every 30 seconds by itself.
3. Temporal answers at `TEMPORAL_ADDRESS`, and at least one instance has
   `NOTIFICATION_WORKER_ENABLED=true`.
4. No sample at all with the service up: its telemetry is off (`OTEL_EXPORTER_OTLP_ENDPOINT`).

## Canary missing

`notification_canary_missing` (page): the provider has not accepted a canary on one channel for
30 minutes (label `channel`).

1. `notification_deliveries` rows of type `DELIVERY_CANARY` for that channel, newest first:
   `FAILED` gives the `error_code`, `SKIPPED` the `skip_reason`.
2. No row at all: the schedule did not run (Temporal UI, schedule `notification-delivery-canary`)
   or the event waited (see "Events stuck" below).
3. `FAILED` with a provider code: check the provider's status page and the credentials of that
   channel (`docs/deployment.md` → "Notification delivery").
4. `SKIPPED` with `no_provider`, `no_template` or `sender_cap`: a setting or a sender changed.

## Failure rate

`notification_failure_rate` (page): over 20% of the attempts on a channel failed in 10 minutes,
with at least 20 attempts.

1. The `reason` label of `notification_delivery{status="FAILED"}` in OpenObserve: one code for
   most failures points at the provider or the credentials, many codes at the recipients' data.
2. A provider code meaning unreachable or rate limited: the provider's status page; a second
   provider in `NOTIFICATION_<CHANNEL>_PROVIDER` takes over only for those codes.
3. Auth codes (`EAUTH`, `FCM_AUTH`, …): rotated or expired credentials.

## Sender blocked

`notification_sender_blocked` (page): a WhatsApp sender's status is `BLOCKED` (label `channel`):
the provider refused a send with `WA_SENDER_BLOCKED`. It lasts until the sender is active again.

1. WhatsApp: the service has already marked the sender `BLOCKED` and opened its breaker, so an
   institute's messages go through the platform's sender. Resolve the restriction in the
   provider's console, then activate the sender again in the admin portal's messaging senders;
   activating clears its breaker and its throttle.
2. A blocked platform sender leaves WhatsApp without a sender: messages are skipped
   `no_provider` until it is active again.
3. SMS has no sender row: `SMS_SENDER_BLOCKED` opens the SMS provider's breaker and raises
   "Breaker opened" below. The sender header or the account was suspended at the provider; check
   the registration.

## Breaker opened

`notification_breaker_opened` (page): a circuit breaker is open (labels `channel`, `provider`): a
provider or a WhatsApp sender answered "cannot send now" 5 times in a row within a minute, or
blocked the sender. The code that opened it is the `reason` label of the counter
`notification_breaker_opened`. The alert clears when a send through it succeeds, or 10 minutes
after it opened if nothing is sent through it.

1. Sends through it are held as `DEFERRED` with `provider_paused` and tried again after a
   minute, when one probe goes through: a success closes the breaker, a failure keeps it open
   for another minute. With a second provider in `NOTIFICATION_<CHANNEL>_PROVIDER`, that one
   takes the messages meanwhile; an institute's own WhatsApp sender falls back to the platform's.
2. `reason` `*_UNREACHABLE`, `FCM_SERVER_ERROR` or an SMTP connection code: the provider's status
   page and the network from the service to it.
3. `reason` `EAUTH`, `FCM_AUTH` or `*_SENDER_BLOCKED`: credentials or the account; see "Sender
   blocked" above for WhatsApp.
4. Nothing is lost while it is open: a message gives up only after about 8 hours of holds, and
   is then recorded `SKIPPED` with `provider_paused`.

## Events stuck

`notification_events_stuck` (page): an event on the `NOTIFICATION` stream waited over 5 minutes
for its consumer (label `consumer`).

1. The notification service is running and connected to NATS (its log, `GET /health`).
2. The service's log for `Handler failed for "NOTIFICATION.…"`: a handler that keeps failing
   holds its consumer until the message is dead-lettered.
3. `jetstream_consumer_num_pending` and `jetstream_consumer_num_ack_pending` of that consumer
   show whether it is idle or overloaded.

## Dead letters

`notification_dead_letters` (ticket): a `NOTIFICATION.*` event was dead-lettered in the last 5
minutes, so its notification was never sent.

1. The admin portal's Dead Letter Queue tab: the subject and the error of the message.
2. Fix the cause, then replay it from there; the handlers are safe to run twice.
3. More on the queue: [DLQ message spike](dlq-messages.md).

## Skips rising

`notification_skips_rising` (ticket): deliveries were skipped with `no_provider` or `no_template`
in the last 15 minutes (labels `channel`, `reason`).

1. `no_provider`: `NOTIFICATION_<CHANNEL>_PROVIDER` is unset on that service, or WhatsApp has no
   active sender.
2. `no_template`: a template is missing from `SMS_TEMPLATE_IDS` or not approved by the provider
   (`docs/deployment.md` → "SMS" and "WhatsApp alerts").
3. Expected while a channel is being set up; the alert stops once the skips stop.

## Template rejected

`notification_template_rejected` (ticket): a WhatsApp template is `REJECTED`, `PAUSED` or
`DISABLED` at the provider on some account, or has waited 48 hours for its review
(`PENDING_LONG`); the label `reason` says which. Sends of the alerts that use it are skipped as
`no_template` on that account, before the provider is called. Only names the code still defines
are counted, on accounts that have a sender.

1. The admin Monitoring page's "WhatsApp senders": each sender lists its templates with their
   status and the provider's rejection reason.
2. A rejection names the rule the body broke: fix the wording under a new name (`…_v2`), never
   by editing the provider's copy. "Sync now" submits it; the sync retires the old name's row,
   which clears the alert.
3. A paused template recovers by itself when its quality improves; the provider's console shows
   the quality.
4. `PENDING_LONG`: press "Sync now" (it reads the provider's list again). Still waiting: the
   review is stuck at the provider; ask its support.

## Template changed

`notification_template_changed` (ticket): the provider approved a template under another
category than the one declared (`CATEGORY_CHANGED`), or its text was edited at the provider
(`OUT_OF_STEP`). A recategorised template is not sent, so nothing goes out at the other price.

1. "WhatsApp senders" on the Monitoring page shows which template and on which account.
2. `CATEGORY_CHANGED`: the body does not say what it is about for the reader (their ward, their
   account, their request). Reword it under a new name and sync.
3. `OUT_OF_STEP`: someone edited it in the provider's console. Bring the code's definition and
   the provider's copy back together under a new name.

## Checking that an alert fires

The e2e stack has no metrics store, so an alert is checked on the dev stack after a change to its
rule or to the metric it reads. Each single-event alert reads a gauge (`docs/infrastructure.md` →
"Observability"), so the first event after a restart counts.

1. `pnpm tilt trigger observability` loads the rules and restarts both services.
2. Cause one event of the kind the rule watches, for example a send to a channel whose provider
   is unset (`no_provider`), or a breaker opened by stopping the provider (5 failed sends within a
   minute).
3. Within a minute the rule's query in OpenObserve (Metrics, PromQL) answers above 0, and the
   alert fires on its next run. When the condition ends, the query reads 0 on the next export.
