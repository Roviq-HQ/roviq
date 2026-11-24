# Events: publishing and consuming with `@roviq/nats-jetstream`

NestJS custom transport for NATS JetStream. Provides `@EventPattern`/`@MessagePattern` decorator support with durable pull consumers, automatic context propagation, DLQ, retry with exponential backoff, and concurrency control.

## Quick Start

### Server (consumer side)

```typescript
// main.ts
import { connectJetStreamMicroservice, STREAMS } from '@roviq/nats-jetstream';

connectJetStreamMicroservice(app, {
  servers: [config.getOrThrow('NATS_URL')],
  streams: Object.values(STREAMS),
  dlq: { enabled: true },
});
await app.startAllMicroservices();
```

`connectJetStreamMicroservice` is the only way an app connects the transport
(`pnpm check:event-handlers` refuses a bare `app.connectMicroservice()`). It:

- connects `JetStreamServer` with `inheritAppConfig: false`, so the HTTP/GraphQL global guards,
  filters and interceptors do not run for event deliveries;
- installs `RethrowRpcExceptionFilter` (`@Catch()`), which rethrows what the handler threw.
  Without it Nest's default RPC filter replaces every error with `Internal server error`, and
  the retry log and the DLQ row lose the real cause. Nest builds each handler's exception chain
  when the listeners are registered, so the helper connects with `deferInitialization: true`,
  adds the filter, then registers the listeners itself.

### Client (publisher side)

```typescript
// app.module.ts
import { JetStreamClient } from '@roviq/nats-jetstream';

{
  provide: 'JETSTREAM_CLIENT',
  useFactory: async (config: ConfigService) => {
    const client = new JetStreamClient({
      servers: [config.getOrThrow<string>('NATS_URL')],
    });
    await client.connect();
    return client;
  },
  inject: [ConfigService],
}
```

---

## Publishing Events

### Basic publish

```typescript
@Inject('JETSTREAM_CLIENT') private readonly client: ClientProxy;

// Fire-and-forget — emit() is hot, auto-subscribes
this.client.emit('NOTIFICATION.approval.requested', { approvalId, tenantId });
```

Headers (`correlation-id`, `tenant-id`, `actor-id`, `impersonator-id`) are **auto-injected** from AsyncLocalStorage. No manual header passing needed inside request handlers.

### Awaitable publish (for critical events)

```typescript
import { lastValueFrom } from 'rxjs';

const pubAck = await lastValueFrom(
  this.client.emit('AUDIT.log', event),
);
// pubAck contains { stream: 'AUDIT', seq: 42 }
```

### Out-of-context publishing (cron, Temporal, onModuleInit)

When there's no request context in AsyncLocalStorage, pass headers explicitly:

```typescript
import { NatsRecordBuilder } from '@nestjs/microservices';
import { headers } from '@nats-io/nats-core';

const hdrs = headers();
hdrs.set('correlation-id', jobId);
hdrs.set('tenant-id', tenantId);

const record = new NatsRecordBuilder(payload).setHeaders(hdrs).build();
this.client.emit('NOTIFICATION.fee.overdue', record);
```

---

## Consuming Events

### Basic handler

```typescript
import { Controller } from '@nestjs/common';
import { Ctx, EventPattern, Payload } from '@nestjs/microservices';
import { JetStreamContext } from '@roviq/nats-jetstream';

@Controller()
export class AttendanceListener {
  @EventPattern('NOTIFICATION.attendance.absent', {
    stream: 'NOTIFICATION',
    durable: 'notification-attendance',
  })
  async handle(
    @Payload() event: AttendanceAbsentEvent,
    @Ctx() ctx: JetStreamContext,
  ) {
    // Handler runs inside AsyncLocalStorage with request context restored
    await this.notificationService.trigger(event);
    // msg.ack() called automatically on success
  }
}
```

### Wildcard handler (multiple subjects, shared durable)

Use when handling logic is shared or trivially branched:

```typescript
@EventPattern('NOTIFICATION.approval.*', {
  stream: 'NOTIFICATION',
  durable: 'notification-approval',
})
async handle(
  @Payload() event: ApprovalEvent,
  @Ctx() ctx: JetStreamContext,
) {
  const subject = ctx.getSubject();
  if (subject.endsWith('.requested')) {
    await this.handleRequested(event);
  } else if (subject.endsWith('.resolved')) {
    await this.handleResolved(event);
  }
}
```

### Separate handlers (distinct durables)

Prefer when logic diverges or handlers need different concurrency/timeout:

```typescript
@EventPattern('NOTIFICATION.approval.requested', {
  durable: 'notification-approval-requested',
})
async handleRequested(@Payload() event: ApprovalRequestedEvent) { /* ... */ }

@EventPattern('NOTIFICATION.approval.resolved', {
  durable: 'notification-approval-resolved',
})
async handleResolved(@Payload() event: ApprovalResolvedEvent) { /* ... */ }
```

### Several handlers for one subject

A workqueue stream lets one consumer filter on a subject, so every handler of that subject in
an app shares one durable. The server keeps all of them and runs them for each delivery in
registration order, one after another, under one `handlerTimeout`. If any handler throws, the
delivery fails (nak with backoff, DLQ after `maxDeliver`) and the later handlers do not run on
that attempt; on redelivery the whole chain runs again, so every handler must be idempotent.
All handlers of a subject must declare the same extras (`stream`, `durable`, `maxDeliver`,
`ackWait`, …); start-up fails with an error naming the subject and both values otherwise.

A handler that throws resolves through Nest's RPC exception filter into an erroring Observable;
the server unwraps it, so the failure reaches the retry and DLQ path instead of being acked.
`RethrowRpcExceptionFilter` keeps the original error object in that Observable.

The class must be listed in its module's `controllers`, and the app's `main.ts` must call
`connectJetStreamMicroservice()`: Nest scans only controllers for message patterns, and without the
transport nothing subscribes. `pnpm check:event-handlers` fails the build on either mistake.

### api-gateway consumers

The gateway consumes some of its own events (ROV-316). Its `main.ts` connects through
`connectJetStreamMicroservice` (`inheritAppConfig: false`), so the HTTP/GraphQL global guards, exception filter and audit
interceptor do not run for event deliveries (they read a request an event does not have).

| Subject | Handlers | Effect |
| ------- | -------- | ------ |
| `ACADEMIC_YEAR.activated` | `StudentEventHandler`, `GroupInvalidationHandler` | Continuing students get a row in the new year by the year-end promotion rule below; dynamic groups are invalidated |
| `SECTION.deleted` | `StudentEventHandler`, `GroupInvalidationHandler` | The deleted section's `student_academics` rows are soft-deleted; section-based groups are invalidated |
| `STUDENT.enrolled`, `STUDENT.section_changed`, `STUDENT.promoted`, `STUDENT.left` | `GroupInvalidationHandler` | Groups whose rules use the changed dimension get `resolved_at = NULL` |
| `STUDENT.removed_from_year` | `GroupInvalidationHandler` | Every dynamic and hybrid group of the institute gets `resolved_at = NULL` (emitted by `removeStudentFromYear`) |
| `GROUP.rules_updated` | `GroupInvalidationHandler` | That group gets `resolved_at = NULL` |

- **Durable naming**: `gateway-<subject in kebab case>` (e.g. `gateway-academic-year-activated`),
  with an explicit `stream`, both from `gatewayConsumer(pattern)` in
  `apps/api-gateway/src/common/events/gateway-consumer.ts`. Every gateway handler of a subject
  uses it, so they cannot disagree.
- **Payloads** are validated first with `eventPayloadSchemas[pattern].parse(data)`; a payload
  that fails goes to the DLQ after the retries.
- **Tenant isolation**: each handler runs in `withTenant(db, mkInstituteCtx(tenantId, origin), …)`
  with the event's `tenantId`, reads `*Live` views and writes base tables. An id of another
  institute in the payload matches nothing under RLS.
- **Idempotency**: each handler is safe to run twice and harmless for an institute, year, section
  or group that no longer exists. `SECTION.deleted` acts only while the section is still deleted.

#### Year-end promotion rule (`ACADEMIC_YEAR.activated`)

`rollOverStudents()` in `apps/api-gateway/src/institute/student/year-rollover.ts` is one SQL
statement shared by the consumer (`write: true`) and the `academicYearRolloverPreview` query
(`write: false`), so the preview and the rollover cannot disagree. For each live
`student_academics` row of the previous year whose student is still ENROLLED, PROMOTED, DETAINED
or RE_ENROLLED, the row's `promotion_status` decides the target level (`numeric_order`):

| `promotion_status` | Target level |
| ------------------ | ------------ |
| `PROMOTED` with `promoted_to_standard_id` | That standard's level |
| `PROMOTED` without a target; `PENDING` or none (not a COACHING institute) | The next level: the smallest order above the current one among the live standards of either year, so a class added only in the new year receives last year's top class |
| `PENDING` or none in a COACHING institute; `DETAINED` | The same level |
| `GRADUATED`, `TRANSFERRED` | No row (`notCarried`) |

The target level is matched to the new year's standard with that `numeric_order`. The section
in that standard is chosen in this order:

1. The section the admin mapped the student's previous section to: a live row of
   `year_rollover_section_map` for the year being activated, used only when its target is a live
   section of that standard. An override of 5-B to 6-C therefore does not move a detained 5-B
   student.
2. The live section whose English name (`name->>'en'`, trimmed, case-insensitive) equals the
   previous section's, so 5-B moves to 6-B and a detained 5-B student stays in 5-B.
3. The section with the lowest `display_order` (then id).

Section capacity is not checked. The function also returns `moves`: the number of students per
previous section and target section, from which the preview builds its per-section sizes.
`setRolloverSectionMap` reads both sections under the caller's institute before storing a row,
and a trigger on the table refuses a row whose sections are not of the row's institute or whose
target section is not in the row's year.
There is no capacity check. The insert is `ON CONFLICT
DO NOTHING` on the live `(student_profile_id, academic_year_id)` index, so redelivery is safe.
The handler logs one line with the counts: `movingUp`, `staying`, `completing` (top level, no
next level), `notCarried`, `noClassInNewYear` (no standard or section at the target level) and
`alreadyPlaced` (any row, live or deleted, already in the new year).

### JetStreamContext API

```typescript
ctx.getSubject()         // 'NOTIFICATION.approval.requested'
ctx.getStream()          // 'NOTIFICATION'
ctx.getDurableName()     // 'notification-approval'
ctx.getDeliveryCount()   // 1 (1-based)
ctx.getSequence()        // { stream: 42, consumer: 7 }
ctx.getCorrelationId()   // from headers
ctx.getTenantId()        // from headers, or undefined
ctx.getHeaders()         // raw NATS headers object
ctx.signal               // AbortSignal for cooperative cancellation (optional)
ctx.setNakDelay(5000)    // override backoff delay for this message
```

### Cooperative cancellation

For long-running handlers, check the abort signal between steps:

```typescript
async handle(@Payload() event: HeavyEvent, @Ctx() ctx: JetStreamContext) {
  await this.step1(event);
  if (ctx.signal?.aborted) return;
  await this.step2(event);
  if (ctx.signal?.aborted) return;
  await this.step3(event);
}
```

---

## ConsumerExtras — Full Options

```typescript
@EventPattern('NOTIFICATION.approval.requested', {
  stream: 'NOTIFICATION',          // inferred from subject if omitted
  durable: 'notification-approval', // slugified from subject if omitted
  maxDeliver: 5,                    // from stream config if omitted
  concurrency: 3,                   // default 1 (sequential)
  handlerTimeout: 15_000,           // default 25_000ms
  pull: {
    batchSize: 20,                  // default 10
    idleHeartbeat: 15_000,          // default 30_000ms
    expires: 30_000,                // default 60_000ms
  },
})
```

---

## Stream Configuration

Streams are defined in `STREAMS` constant and auto-created on server startup:

| Stream | Subjects | Retention | maxDeliver | Purpose |
|---|---|---|---|---|
| INSTITUTE | `INSTITUTE.>` | workqueue | 3 | Institute domain events |
| ADMIN | `ADMIN.>` | workqueue | 3 | Platform admin events |
| NOTIFICATION | `NOTIFICATION.>` | workqueue | 5 | User notifications |
| AUDIT | `AUDIT.>` | limits | 5 | Audit log events |
| BILLING | `BILLING.>` | workqueue | 3 | Billing/payment events |
| DLQ | `DLQ.>` | limits | 1 | Dead Letter Queue |

### Adding a new stream

1. Add to `STREAMS` in `libs/backend/nats-jetstream/src/streams/stream.config.ts`
2. Publishers emit to `STREAMNAME.entity.action` subjects
3. Consumers use `@EventPattern('STREAMNAME.entity.action', { stream: 'STREAMNAME', durable: '...' })`

### Stream inference

When `stream` is omitted from `@EventPattern` extras, the server infers it by uppercasing the first segment:

```
'NOTIFICATION.approval.requested' → stream 'NOTIFICATION'
'BILLING.webhook.razorpay'        → stream 'BILLING'
```

---

## Error Handling

### Retry with exponential backoff

On handler failure, messages are nak'd with increasing delay:

```
Delivery 1 → nak(1s)
Delivery 2 → nak(2s)
Delivery 3 → nak(4s)
Delivery 4 → nak(8s)
...capped at 60s
```

Override per-message via `ctx.setNakDelay(ms)`.

Configure globally via server options:
```typescript
new JetStreamServer({
  retry: { baseDelay: 1_000, maxDelay: 60_000 },
})
```

### Failure log

Every failed delivery logs one error line with the pattern, the delivery count, what happens
next (nak delay or DLQ) and the error text, with the stack attached:

```
Handler failed for "GROUP.rules_updated" (delivery 2/3), nak with 2000ms delay: ZodError: [...]
```

### Dead Letter Queue (DLQ)

After `maxDeliver` retries exhausted:
1. Message published to `DLQ.<ORIGIN_STREAM>` (e.g. `DLQ.NOTIFICATION`)
2. Original message terminated

DLQ payload includes: `originalSubject`, `payload`, `error`, `retryCount`, `correlationId`, `tenantId`, `failedAt`.

`error` comes from `deadLetterErrorText(err)`: `<error name>: <message of the innermost cause>`,
cut to 500 characters. A Drizzle query error therefore stores the PostgreSQL message (for example
`Error: duplicate key value violates unique constraint "…"`), never the SQL text or its
parameters.

**Safe DLQ**: If DLQ publish fails, message is nak'd with 60s delay instead of terminated. Message is never lost unless both handler AND DLQ are broken.

### Deserialization errors

Malformed payloads (can't parse JSON) are immediately sent to DLQ and terminated — no retries (pointless for garbage data).

### Handler timeout

Default: 25s (`handlerTimeout`). Must be less than NATS `ack_wait` (default 30s).

On timeout:
- AbortSignal fires (cooperative cancellation)
- Message nak'd with backoff
- **Handler continues running** — timeout only frees the consumer slot
- Handlers must be idempotent

---

## Concurrency

Default: sequential (`concurrency: 1`). Opt-in with:

```typescript
@EventPattern('NOTIFICATION.user.*', {
  durable: 'notification-user-sync',
  concurrency: 5,
})
```

Uses an internal semaphore. At `concurrency: 1`, zero overhead (same as no semaphore).

---

## Audit Consumer (Special Case)

The audit consumer (`audit.consumer.ts`) does batched pull consumption (50 msgs / 500ms flush). It stays **outside** the transport with its own raw `NatsConnection`. It imports `publishToDlq` and `ensureStreams` from `@roviq/nats-jetstream` but does not use `@EventPattern`.

---

## Conventions

1. **Stream names are UPPERCASE** — `NOTIFICATION`, `BILLING`, `DLQ`
2. **Subject format** — `STREAM.entity.action` (e.g. `NOTIFICATION.approval.requested`)
3. **`handlerTimeout` < `ack_wait`** — default 25s vs NATS default 30s
4. **Handlers must be idempotent** — JetStream guarantees at-least-once, not exactly-once
5. **Out-of-context publishing** uses `NatsRecordBuilder` with explicit headers
6. **DLQ subject** — `DLQ.<ORIGIN_STREAM>`, full original subject in payload

---

## Troubleshooting

### `void client.emit(...)` silently drops events
This was the old `ClientProxy.emit()` behavior (cold Observable). `JetStreamClient.emit()` is hot — it fires immediately. If you still see dropped events, check that the client is connected (`await client.connect()` in the provider factory).

### Missing request context warning
```
JetStreamClient: No request context (cron/Temporal/onModuleInit?)
```
You're publishing outside a request handler. Use `NatsRecordBuilder` with explicit headers.

### Config drift on rolling deploys
If you change a stream's subjects or maxDeliver and do a rolling deploy, old instances may have old config. The server handles this with `streams.add()` → fallback to `streams.update()`. **Immutable fields** (retention, storage) cannot be auto-updated — require manual migration.

### Consumer not receiving messages
Run `pnpm check:event-handlers`: the handler class must be in a module's `controllers` (not `providers`) and the app's `main.ts` must call `connectJetStreamMicroservice()`.
Check that the `filter_subject` matches your published subject. Wildcard `*` matches one token, `>` matches one or more. The server uses the `@EventPattern` subject as the `filter_subject`.
