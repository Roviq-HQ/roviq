import type { Server } from 'node:http';
import { type INestApplication, Logger, type LoggerService } from '@nestjs/common';
import { ModulesContainer } from '@nestjs/core';
import { shutdownTelemetry } from './telemetry-lifecycle';

/** Longest a signal-driven shutdown may take before the process exits with code 1. */
export const SHUTDOWN_TIMEOUT_MS = 10_000;
/** The OTLP exporters retry an unreachable collector for seconds; the app is closed by then. */
export const TELEMETRY_FLUSH_TIMEOUT_MS = 2_000;

const SHUTDOWN_SIGNALS: readonly NodeJS.Signals[] = ['SIGTERM', 'SIGINT'];
const LIFECYCLE_HOOKS = [
  'onModuleDestroy',
  'beforeApplicationShutdown',
  'onApplicationShutdown',
] as const;

export interface HookOwner {
  name: string;
  instance: unknown;
}

export interface ShutdownDeps {
  timeoutMs: number;
  telemetryFlushTimeoutMs: number;
  exit: (code: number) => void;
  logger: LoggerService;
  hookOwners: (app: INestApplication) => HookOwner[];
  flushTelemetry: () => Promise<void>;
}

function providersOf(app: INestApplication): HookOwner[] {
  const owners: HookOwner[] = [];
  for (const module of app.get(ModulesContainer).values()) {
    for (const wrapper of [...module.providers.values(), ...module.controllers.values()]) {
      owners.push({ name: String(wrapper.name), instance: wrapper.instance });
    }
  }
  return owners;
}

const defaultDeps = (): ShutdownDeps => ({
  timeoutMs: SHUTDOWN_TIMEOUT_MS,
  telemetryFlushTimeoutMs: TELEMETRY_FLUSH_TIMEOUT_MS,
  exit: (code) => process.exit(code),
  logger: new Logger('Shutdown'),
  hookOwners: providersOf,
  flushTelemetry: shutdownTelemetry,
});

/**
 * Wraps each lifecycle hook so a stuck shutdown can name what is still closing.
 * Returns the live set of hooks that started and have not finished.
 */
export function trackLifecycleHooks(owners: Iterable<HookOwner>): ReadonlySet<string> {
  const pending = new Set<string>();
  const seen = new WeakSet<object>();
  for (const { name, instance } of owners) {
    if (typeof instance !== 'object' || instance === null || seen.has(instance)) continue;
    seen.add(instance);
    for (const hook of LIFECYCLE_HOOKS) {
      const original: unknown = Reflect.get(instance, hook);
      if (typeof original !== 'function') continue;
      const label = `${name}.${hook}`;
      Reflect.set(instance, hook, async (...args: unknown[]) => {
        pending.add(label);
        try {
          return await Reflect.apply(original, instance, args);
        } finally {
          pending.delete(label);
        }
      });
    }
  }
  return pending;
}

/**
 * The one owner of the shutdown signal: stop accepting connections, close the app (Nest runs
 * onModuleDestroy, beforeApplicationShutdown, closes HTTP and microservices, then
 * onApplicationShutdown), flush telemetry, exit 0. Past `timeoutMs` it exits 1 instead.
 */
export async function shutdownGracefully(
  app: INestApplication,
  signal: NodeJS.Signals,
  deps: ShutdownDeps = defaultDeps(),
): Promise<void> {
  const { logger, exit, timeoutMs } = deps;
  const pending = trackLifecycleHooks(deps.hookOwners(app));
  let stage = 'the application';
  const deadline = setTimeout(() => {
    const waitingOn = pending.size > 0 ? [...pending].join(', ') : stage;
    logger.error(`Shutdown exceeded ${timeoutMs} ms; still closing: ${waitingOn}`);
    exit(1);
  }, timeoutMs);

  try {
    logger.log(`${signal} received, shutting down`);
    const server: Server = app.getHttpServer();
    if (server.listening) server.close();
    stage = 'the HTTP server and microservices';
    await app.close();
    stage = 'telemetry';
    await flushTelemetryWithin(deps);
    clearTimeout(deadline);
    logger.log('Shutdown complete');
    exit(0);
  } catch (err) {
    clearTimeout(deadline);
    logger.error({ err }, `Shutdown failed while closing ${stage}`);
    exit(1);
  }
}

/** The app closed cleanly by now: a collector that fails or stalls loses its last batch, not the exit code. */
async function flushTelemetryWithin({
  flushTelemetry,
  telemetryFlushTimeoutMs,
  logger,
}: ShutdownDeps): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const finished = await Promise.race([
    flushTelemetry().then(
      () => true,
      (err: unknown) => {
        logger.error({ err }, 'Telemetry flush failed');
        return true;
      },
    ),
    new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), telemetryFlushTimeoutMs);
    }),
  ]);
  clearTimeout(timer);
  if (!finished) {
    logger.warn(`Telemetry flush did not finish within ${telemetryFlushTimeoutMs} ms; dropped it`);
  }
}

/** Registers the shutdown for SIGTERM and SIGINT; a repeated signal is ignored. */
export function enableGracefulShutdown(
  app: INestApplication,
  deps: ShutdownDeps = defaultDeps(),
): void {
  let started = false;
  const onSignal = (signal: NodeJS.Signals) => {
    if (started) return;
    started = true;
    void shutdownGracefully(app, signal, deps);
  };
  for (const signal of SHUTDOWN_SIGNALS) process.on(signal, onSignal);
}
