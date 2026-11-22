import { metrics } from '@opentelemetry/api';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isTelemetryActive,
  shutdownTelemetry,
  startTelemetry,
  type TelemetryOptions,
} from '../telemetry-lifecycle';

const OPTIONS: TelemetryOptions = {
  endpoint: 'http://collector:4317',
  serviceName: 'api-gateway',
  serviceVersion: '1.2.3',
  environment: 'production',
};

function fakeSdkModule() {
  const sdk = { start: vi.fn(), shutdown: vi.fn(async () => undefined) };
  const createTelemetrySdk = vi.fn(() => sdk);
  return { sdk, load: vi.fn(() => ({ createTelemetrySdk })), createTelemetrySdk };
}

describe('startTelemetry', () => {
  afterEach(async () => {
    await shutdownTelemetry();
    vi.unstubAllEnvs();
  });

  it('should not load or start the SDK when no endpoint is set', () => {
    const { load } = fakeSdkModule();

    const started = startTelemetry({ ...OPTIONS, endpoint: undefined }, load);

    expect(started).toBe(false);
    expect(load).not.toHaveBeenCalled();
    expect(isTelemetryActive()).toBe(false);
  });

  it('should treat an empty endpoint as unset', () => {
    const { load } = fakeSdkModule();

    expect(startTelemetry({ ...OPTIONS, endpoint: '' }, load)).toBe(false);
    expect(load).not.toHaveBeenCalled();
  });

  it('should start the SDK for the endpoint when one is set', () => {
    const { load, sdk, createTelemetrySdk } = fakeSdkModule();

    const started = startTelemetry(OPTIONS, load);

    expect(started).toBe(true);
    expect(createTelemetrySdk).toHaveBeenCalledWith('http://collector:4317', OPTIONS);
    expect(sdk.start).toHaveBeenCalledTimes(1);
    expect(isTelemetryActive()).toBe(true);
  });

  it('should start the SDK only once', () => {
    const first = fakeSdkModule();
    const second = fakeSdkModule();

    startTelemetry(OPTIONS, first.load);

    expect(startTelemetry(OPTIONS, second.load)).toBe(false);
    expect(second.load).not.toHaveBeenCalled();
  });

  it('should register no signal handler in either branch', () => {
    const before = process.listenerCount('SIGTERM') + process.listenerCount('SIGINT');

    startTelemetry({ ...OPTIONS, endpoint: undefined }, fakeSdkModule().load);
    startTelemetry(OPTIONS, fakeSdkModule().load);

    expect(process.listenerCount('SIGTERM') + process.listenerCount('SIGINT')).toBe(before);
  });

  it('should leave the SDK unloaded when the preload runs without an endpoint', async () => {
    vi.stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', '');
    vi.resetModules();

    await import('../init-telemetry');
    const lifecycle = await import('../telemetry-lifecycle');

    expect(lifecycle.isTelemetryActive()).toBe(false);
  });
});

describe('shutdownTelemetry', () => {
  it('should flush and stop a started SDK once', async () => {
    const { load, sdk } = fakeSdkModule();
    startTelemetry(OPTIONS, load);

    await shutdownTelemetry();
    await shutdownTelemetry();

    expect(sdk.shutdown).toHaveBeenCalledTimes(1);
    expect(isTelemetryActive()).toBe(false);
  });

  it('should resolve when telemetry is off', async () => {
    await expect(shutdownTelemetry()).resolves.toBeUndefined();
  });
});

describe('OpenTelemetry API without an SDK', () => {
  it('should hand out meters whose instruments record nothing and never call back', () => {
    const meter = metrics.getMeter('resilience');
    const callback = vi.fn();

    meter.createObservableGauge('circuit_breaker_state').addCallback(callback);
    meter.createCounter('audit_events_consumed_total').add(1, { tenant_id: 't' });
    meter.createHistogram('latency').record(5);

    expect(callback).not.toHaveBeenCalled();
    expect(metrics.getMeterProvider().constructor.name).toBe('NoopMeterProvider');
  });
});
