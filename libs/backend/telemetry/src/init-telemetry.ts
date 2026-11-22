import { startTelemetry } from './telemetry-lifecycle';

// Preloaded with `--require` before the app, so instrumentations patch modules before they load.
const env = process.env;
startTelemetry({
  endpoint: env['OTEL_EXPORTER_OTLP_ENDPOINT'],
  serviceName: env['OTEL_SERVICE_NAME'],
  serviceVersion: env['OTEL_SERVICE_VERSION'],
  environment: env['NODE_ENV'],
});
