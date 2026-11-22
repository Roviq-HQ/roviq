import type * as TelemetrySdkModule from './telemetry-sdk';

export interface TelemetryOptions {
  /** OTLP gRPC endpoint; unset turns telemetry off. */
  endpoint: string | undefined;
  serviceName: string | undefined;
  serviceVersion: string | undefined;
  environment: string | undefined;
}

interface TelemetrySdk {
  start(): void;
  shutdown(): Promise<void>;
}

// Loaded only when telemetry is on: the SDK and its instrumentations take ~0.2-0.5 s to require.
const loadSdkModule = (): typeof TelemetrySdkModule => require('./telemetry-sdk');

let activeSdk: TelemetrySdk | null = null;

/**
 * Starts the OpenTelemetry SDK when an endpoint is set. Registers no signal handler: the app's
 * graceful shutdown owns the signal and calls `shutdownTelemetry()` after the app closed.
 */
export function startTelemetry(
  options: TelemetryOptions,
  loadSdk: () => Pick<typeof TelemetrySdkModule, 'createTelemetrySdk'> = loadSdkModule,
): boolean {
  if (!options.endpoint || activeSdk) return false;
  const sdk = loadSdk().createTelemetrySdk(options.endpoint, options);
  sdk.start();
  activeSdk = sdk;
  return true;
}

export function isTelemetryActive(): boolean {
  return activeSdk !== null;
}

/** Flushes and stops the SDK; a no-op when telemetry is off. */
export async function shutdownTelemetry(): Promise<void> {
  const sdk = activeSdk;
  activeSdk = null;
  await sdk?.shutdown();
}
