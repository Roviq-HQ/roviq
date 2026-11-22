import type {
  ConsumerMessages,
  JsMsg,
  JetStreamClient as NatsJetStreamClient,
} from '@nats-io/jetstream';
import {
  AckPolicy,
  DeliverPolicy,
  JetStreamApiError,
  jetstream,
  jetstreamManager,
} from '@nats-io/jetstream';
import type { NatsConnection } from '@nats-io/nats-core';
import { connect } from '@nats-io/transport-node';
import { Logger } from '@nestjs/common';
import {
  type MsPattern,
  type MessageHandler as NestMessageHandler,
  ServerNats,
} from '@nestjs/microservices';
import { AuthScope } from '@roviq/common-types';
import { type RequestContext, requestContext } from '@roviq/request-context';
import { RESILIENT_NATS_OPTIONS } from '../connection-options';
import { JetStreamContext, type JetStreamMeta } from '../context/jetstream.context';
import { publishToDlq } from '../dlq/dlq.handler';
import type {
  ConsumerExtras,
  JetStreamServerOptions,
  ResolvedConsumerConfig,
} from '../interfaces/jetstream.options';
import { assertDriftRecreateAllowed } from '../streams/drift-gate';
import { DEFAULT_DLQ_STREAM } from '../streams/stream.config';
import { ensureStreams } from '../streams/stream.manager';
import { deadLetterErrorText } from './error-text';
import { DeserializationError, HandlerTimeoutError } from './errors';
import { assertConsistentExtras, type ChainHandler, runHandlerChain } from './handler-chain';
import { resolveConsumerConfig } from './resolve-consumer-config';
import { Semaphore } from './semaphore';

/**
 * NestJS microservice event packet: client serializers wrap the outgoing
 * value as `{ pattern, data }`. See @nestjs/microservices NatsRecordSerializer
 * (line 18): `jsonCodec.encode({ ...packet, data: natsMessage.data })`.
 *
 * The server MUST extract `.data` before passing to handlers — this is
 * what NestJS's own `ServerNats.handleMessage` → `handleEvent` does.
 */
interface IncomingPacket {
  pattern: string;
  data: unknown;
}

type MessageHandler = ChainHandler<JetStreamContext>;

/**
 * NestJS custom transport server that uses JetStream pull consumers
 * for durable, at-least-once message delivery.
 *
 * Extends ServerNats to reuse NATS connection lifecycle, serialization,
 * and message routing. Overrides listen(), bindEvents(), and close()
 * to use JetStream consumers instead of core NATS subscriptions.
 *
 * @see docs/superpowers/specs/2026-03-17-nats-jetstream-transport-design.md
 */
export class JetStreamServer extends ServerNats {
  protected override readonly logger = new Logger(JetStreamServer.name);

  private readonly consumers = new Map<string, ConsumerMessages>();
  /** Every event handler per pattern, in registration order (Nest would chain them via `next`). */
  private readonly handlerChains = new Map<string, MessageHandler[]>();
  private js!: NatsJetStreamClient;
  private nc!: NatsConnection;

  private readonly jsOptions: JetStreamServerOptions;

  constructor(options: JetStreamServerOptions) {
    // ServerNats expects NatsOptions['options'] which has [key: string]: any
    // so our extra fields pass through safely
    super(options as Parameters<typeof ServerNats.prototype.listen>[0] & JetStreamServerOptions);
    this.jsOptions = options;
  }

  /**
   * Nest links a second event handler of a pattern to the first through `next` and runs both
   * in parallel from the first. Keep them in a list instead, so a delivery runs them one after
   * another and fails when any of them fails.
   */
  override addHandler(
    pattern: MsPattern,
    callback: NestMessageHandler,
    isEventHandler = false,
    extras: Record<string, unknown> = {},
  ): void {
    const route = this.normalizePattern(pattern);
    const chain = this.handlerChains.get(route);
    if (isEventHandler && chain && this.messageHandlers.has(route)) {
      callback.isEventHandler = true;
      callback.extras = extras;
      chain.push(callback);
      return;
    }
    super.addHandler(pattern, callback, isEventHandler, extras);
    this.handlerChains.set(route, [callback]);
  }

  /** The handlers a delivery on `pattern` runs; `handler` is the head Nest stored. */
  handlerChainFor(pattern: string, handler: MessageHandler): readonly MessageHandler[] {
    return this.handlerChains.get(pattern) ?? [handler];
  }

  /**
   * Override to use @nats-io/transport-node (v3) instead of the
   * `nats` (v2) package that ServerNats uses via require('nats').
   * This is required because @nats-io/jetstream v3 expects a v3 NatsConnection.
   */
  override createNatsClient(): Promise<NatsConnection> {
    return connect({
      servers: this.jsOptions.servers,
      ...RESILIENT_NATS_OPTIONS,
    });
  }

  override async listen(
    callback: (err?: unknown, ...optionalParams: unknown[]) => void,
  ): Promise<void> {
    try {
      // 1. Create the NATS connection (inherited from ServerNats)
      this.nc = await this.createNatsClient();
      // Store on the inherited private field so close() can drain it
      Object.assign(this, { natsClient: this.nc });

      // 2. Ensure all configured streams exist
      await ensureStreams(this.nc, this.jsOptions.streams);

      // 3. Auto-create DLQ stream if enabled and not already in streams config
      await this.ensureDlqStream();

      // 4. Ensure durable consumers for each @EventPattern handler
      await this.ensureConsumers();

      // 5. Store JetStream client reference
      this.js = jetstream(this.nc);

      // 6. Start pull consumers
      this.bindEvents(this.nc);

      // 7. Handle status updates (inherited)
      void this.handleStatusUpdates(this.nc);

      callback();
    } catch (err) {
      callback(err);
    }
  }

  /**
   * Ensure DLQ stream exists if DLQ is enabled.
   */
  private async ensureDlqStream(): Promise<void> {
    const dlqEnabled = this.jsOptions.dlq?.enabled !== false;
    if (!dlqEnabled) return;

    const dlqStreamName = this.jsOptions.dlq?.stream ?? 'DLQ';
    const dlqAlreadyConfigured = this.jsOptions.streams.some((s) => s.name === dlqStreamName);
    if (!dlqAlreadyConfigured) {
      await ensureStreams(this.nc, [DEFAULT_DLQ_STREAM]);
    }
  }

  /**
   * Create (or update-in-place) durable consumers for each registered
   * `@EventPattern` handler via JetStream Manager. Must be idempotent:
   * the service restarts on code changes in dev, and multiple replicas
   * may start concurrently in prod.
   *
   * On workqueue-retention streams (NOTIFICATION, …) each filter subject
   * may be claimed by ONE consumer. Calling `consumers.add()` a second
   * time with the same durable + same filter now surfaces error 10147
   * ("filtered consumer not unique on workqueue stream") instead of
   * 10148 ("consumer already exists") in newer @nats-io/jetstream
   * releases — so we look up the consumer up front and diff against the
   * desired config rather than relying on add-error semantics.
   */
  private async ensureConsumers(): Promise<void> {
    const jsm = await jetstreamManager(this.nc);

    for (const [pattern, handler] of this.messageHandlers) {
      assertConsistentExtras(pattern, this.handlerChainFor(pattern, handler));
      const config = this.resolveConsumerConfig(
        pattern,
        handler.extras as ConsumerExtras | undefined,
      );

      // Probe existing state. `info` throws with code 10014 ("consumer not
      // found") when the consumer doesn't exist yet — treat that as the
      // add-path signal and let any other error propagate.
      let existing: Awaited<ReturnType<typeof jsm.consumers.info>> | null = null;
      try {
        existing = await jsm.consumers.info(config.stream, config.durable);
      } catch (err) {
        if (!(err instanceof JetStreamApiError && err.code === 10014)) {
          throw err;
        }
      }

      if (!existing) {
        await jsm.consumers.add(config.stream, {
          durable_name: config.durable,
          ack_policy: AckPolicy.Explicit,
          filter_subject: pattern,
          max_deliver: config.maxDeliver,
          ack_wait: config.ackWaitNanos,
        });
        this.logger.log(
          `Consumer "${config.durable}" created on stream "${config.stream}" for "${pattern}"`,
        );
        continue;
      }

      // Consumer exists. Diff every field we write on `add` so drift is
      // caught instead of silently passing. `deliver_policy` is checked
      // defensively against the NATS server default (`all`) — we don't
      // currently set it, but a future change that does will flow
      // through the same code path.
      const matches =
        existing.config.filter_subject === pattern &&
        existing.config.max_deliver === config.maxDeliver &&
        existing.config.ack_policy === AckPolicy.Explicit &&
        existing.config.ack_wait === config.ackWaitNanos &&
        existing.config.deliver_policy === DeliverPolicy.All;
      if (matches) {
        this.logger.log(
          `Consumer "${config.durable}" already matches on stream "${config.stream}" — skipping`,
        );
        continue;
      }

      // Update in place. `consumers.update()` only permits changing
      // mutable fields (not `filter_subject`), so when the filter has
      // drifted we fall back to delete + re-add. That drops any
      // un-acked messages on the old consumer, so gate it behind
      // NATS_STREAM_DRIFT_RECREATE — default (unset) throws.
      const filterDrift = existing.config.filter_subject !== pattern;
      if (filterDrift) {
        assertDriftRecreateAllowed(
          this.logger,
          `Consumer "${config.durable}" on stream "${config.stream}"`,
          `filter_subject "${existing.config.filter_subject}" → "${pattern}"`,
        );
        await jsm.consumers.delete(config.stream, config.durable);
        await jsm.consumers.add(config.stream, {
          durable_name: config.durable,
          ack_policy: AckPolicy.Explicit,
          filter_subject: pattern,
          max_deliver: config.maxDeliver,
          ack_wait: config.ackWaitNanos,
        });
        this.logger.log(
          `Consumer "${config.durable}" re-created on stream "${config.stream}" (filter drift: "${existing.config.filter_subject}" → "${pattern}")`,
        );
      } else {
        await jsm.consumers.update(config.stream, config.durable, {
          max_deliver: config.maxDeliver,
          ack_wait: config.ackWaitNanos,
        });
        this.logger.log(
          `Consumer "${config.durable}" updated on stream "${config.stream}" (max_deliver=${config.maxDeliver}, ack_wait=${config.ackWaitNanos}ns)`,
        );
      }
    }
  }

  /**
   * Override ServerNats.bindEvents() to start JetStream pull consumers
   * instead of core NATS subscriptions.
   */
  override bindEvents(_client: NatsConnection): void {
    for (const [pattern, handler] of this.messageHandlers) {
      const config = this.resolveConsumerConfig(
        pattern,
        handler.extras as ConsumerExtras | undefined,
      );

      // Start the consumer asynchronously — non-blocking
      void this.startConsumer(pattern, this.handlerChainFor(pattern, handler), config);
    }
  }

  /**
   * Start a pull consumer for a single pattern and begin consuming.
   */
  private async startConsumer(
    pattern: string,
    chain: readonly MessageHandler[],
    config: ResolvedConsumerConfig,
  ): Promise<void> {
    try {
      const consumer = await this.js.consumers.get(config.stream, config.durable);

      const messages = await consumer.consume({
        max_messages: config.pull.batchSize,
        idle_heartbeat: config.pull.idleHeartbeat,
        expires: config.pull.expires,
      });

      this.consumers.set(config.durable, messages);
      void this.consumeLoop(pattern, messages, chain, config);
    } catch (err) {
      this.logger.error(
        `Failed to start consumer "${config.durable}" on stream "${config.stream}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Consume loop with semaphore-based concurrency control.
   * Processes messages from the pull consumer's async iterator.
   */
  private async consumeLoop(
    pattern: string,
    messages: ConsumerMessages,
    chain: readonly MessageHandler[],
    config: ResolvedConsumerConfig,
  ): Promise<void> {
    const semaphore = new Semaphore(config.concurrency);

    for await (const msg of messages) {
      await semaphore.acquire();
      void this.processMessage(pattern, msg, chain, config).finally(() => semaphore.release());
    }
  }

  /**
   * Full message lifecycle: deserialize, restore context, execute handler
   * with timeout, and manage ack/nak/dlq.
   */
  private async processMessage(
    pattern: string,
    msg: JsMsg,
    chain: readonly MessageHandler[],
    config: ResolvedConsumerConfig,
  ): Promise<void> {
    const deliveryCount = msg.info.deliveryCount;
    const correlationId = msg.headers?.get('correlation-id') || crypto.randomUUID();
    const tenantId = msg.headers?.get('tenant-id') || undefined;

    // 1. Deserialize the raw JetStream message envelope produced by
    //    JetStreamClient. The client uses NestJS's NatsRecordSerializer
    //    which publishes a JSON-encoded `{ pattern, data }` packet. The
    //    handler expects the unwrapped `data` (matching @Payload()
    //    semantics in the base ServerNats.handleMessage).
    let envelope: IncomingPacket;
    try {
      envelope = msg.json<IncomingPacket>();
    } catch (err) {
      await this.handleDeserializationError(msg, err, deliveryCount, correlationId, tenantId);
      return;
    }

    const payload = envelope?.data ?? envelope;

    // 2. Build context and execute handler with the unwrapped data
    const abort = new AbortController();
    const ctx = this.buildContext(msg, config, deliveryCount, abort.signal);
    const requestCtx = this.buildRequestContext(msg, correlationId, tenantId);

    try {
      await requestContext.run(requestCtx, () =>
        this.executeHandler(chain, payload, ctx, config.handlerTimeout),
      );
      msg.ack();
    } catch (err) {
      if (err instanceof HandlerTimeoutError) {
        abort.abort();
      }
      await this.handleFailure(
        pattern,
        msg,
        ctx,
        err,
        payload,
        config,
        deliveryCount,
        correlationId,
        tenantId,
      );
    }
  }

  /**
   * Handle deserialization errors: publish to DLQ and terminate, or nak on DLQ failure.
   */
  private async handleDeserializationError(
    msg: JsMsg,
    err: unknown,
    deliveryCount: number,
    correlationId: string,
    tenantId: string | undefined,
  ): Promise<void> {
    const error = new DeserializationError(
      `Failed to deserialize message on "${msg.subject}": ${err instanceof Error ? err.message : String(err)}`,
      err,
    );
    this.logger.error(error.message);

    try {
      await publishToDlq(
        this.js,
        msg.subject,
        msg.data,
        error.message,
        deliveryCount,
        correlationId,
        tenantId,
      );
      msg.term('deserialization_error');
    } catch (dlqErr) {
      this.logger.error(
        `Failed to publish deserialization error to DLQ: ${dlqErr instanceof Error ? dlqErr.message : String(dlqErr)}`,
      );
      msg.nak(60_000);
    }
  }

  /**
   * Build JetStreamContext from message metadata.
   */
  private buildContext(
    msg: JsMsg,
    config: ResolvedConsumerConfig,
    deliveryCount: number,
    signal: AbortSignal,
  ): JetStreamContext {
    const meta: JetStreamMeta = {
      stream: config.stream,
      durableName: config.durable,
      deliveryCount,
      sequence: {
        stream: msg.info.streamSequence,
        consumer: msg.info.deliverySequence,
      },
    };

    const ctx = new JetStreamContext([msg.subject, msg.headers, meta]);
    ctx.signal = signal;
    return ctx;
  }

  /**
   * Build RequestContext from NATS headers for AsyncLocalStorage propagation.
   */
  private buildRequestContext(
    msg: JsMsg,
    correlationId: string,
    tenantId: string | undefined,
  ): RequestContext {
    return {
      tenantId: tenantId || null,
      resellerId: msg.headers?.get('reseller-id') || null,
      userId: msg.headers?.get('actor-id') || '',
      scope: (msg.headers?.get('scope') as AuthScope) || 'institute',
      impersonatorId: msg.headers?.get('impersonator-id') || null,
      correlationId,
    };
  }

  /**
   * Handle handler execution failure: one error log with the stack, then exponential backoff,
   * or the DLQ on the last delivery. The rethrow filter means Nest no longer logs it.
   */
  private async handleFailure(
    pattern: string,
    msg: JsMsg,
    ctx: JetStreamContext,
    err: unknown,
    payload: unknown,
    config: ResolvedConsumerConfig,
    deliveryCount: number,
    correlationId: string,
    tenantId: string | undefined,
  ): Promise<void> {
    const errorText = deadLetterErrorText(err);
    const exhausted = deliveryCount >= config.maxDeliver;
    const delay = this.nakDelay(ctx, deliveryCount);
    const next = exhausted ? 'sending to DLQ' : `nak with ${delay}ms delay`;
    this.logger.error(
      `Handler failed for "${pattern}" (delivery ${deliveryCount}/${config.maxDeliver}), ${next}: ${errorText}`,
      err instanceof Error ? err.stack : undefined,
    );

    if (exhausted) {
      await this.sendToDlqOrNak(msg, payload, errorText, deliveryCount, correlationId, tenantId);
    } else {
      msg.nak(delay);
    }
  }

  /**
   * Attempt to publish to DLQ and terminate, or nak with long delay on DLQ failure.
   */
  private async sendToDlqOrNak(
    msg: JsMsg,
    payload: unknown,
    errorMessage: string,
    deliveryCount: number,
    correlationId: string,
    tenantId: string | undefined,
  ): Promise<void> {
    try {
      await publishToDlq(
        this.js,
        msg.subject,
        payload,
        errorMessage,
        deliveryCount,
        correlationId,
        tenantId,
      );
      msg.term('max_retries_exhausted');
    } catch (dlqErr) {
      this.logger.error(
        `Failed to publish to DLQ after max retries: ${dlqErr instanceof Error ? dlqErr.message : String(dlqErr)}`,
      );
      msg.nak(60_000);
    }
  }

  /** Exponential backoff, unless the handler set its own nak delay. */
  private nakDelay(ctx: JetStreamContext, deliveryCount: number): number {
    const baseDelay = this.jsOptions.retry?.baseDelay ?? 1_000;
    const maxDelay = this.jsOptions.retry?.maxDelay ?? 60_000;
    return ctx.getNakDelay() ?? Math.min(baseDelay * 2 ** (deliveryCount - 1), maxDelay);
  }

  /**
   * Run the handler chain under one timeout using Promise.race.
   * The AbortController signal is set on the context so handlers
   * can cooperatively cancel long-running operations.
   */
  private executeHandler(
    chain: readonly MessageHandler[],
    payload: unknown,
    ctx: JetStreamContext,
    timeout: number,
  ): Promise<unknown> {
    let timer: ReturnType<typeof setTimeout>;

    return Promise.race([
      runHandlerChain(chain, payload, ctx).finally(() => clearTimeout(timer)),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new HandlerTimeoutError(timeout));
        }, timeout);
      }),
    ]);
  }

  /**
   * Resolve consumer configuration from pattern and optional extras,
   * applying defaults and stream inference.
   */
  private resolveConsumerConfig(pattern: string, extras?: ConsumerExtras): ResolvedConsumerConfig {
    return resolveConsumerConfig(pattern, extras, this.jsOptions);
  }

  /**
   * Stop all ConsumerMessages iterators and close the NATS connection.
   */
  override async close(): Promise<void> {
    for (const [durable, messages] of this.consumers) {
      try {
        messages.stop();
        this.logger.log(`Consumer "${durable}" stopped`);
      } catch (err) {
        this.logger.error(
          `Error stopping consumer "${durable}": ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    this.consumers.clear();
    await super.close();
  }
}
