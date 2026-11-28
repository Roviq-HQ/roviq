import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-grpc';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-grpc';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { NodeSDK } from '@opentelemetry/sdk-node';
import {
  BatchSpanProcessor,
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
} from '@opentelemetry/sdk-trace-base';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { isUntracedPath, serializeRedisCommand } from './redaction';
import { ListedAttributesSpanExporter } from './span-fields';
import type { TelemetryOptions } from './telemetry-lifecycle';

export function createTelemetrySdk(endpoint: string, options: TelemetryOptions): NodeSDK {
  const isProduction = options.environment === 'production';
  return new NodeSDK({
    sampler: new ParentBasedSampler({
      root: new TraceIdRatioBasedSampler(isProduction ? 0.1 : 1.0),
    }),
    spanProcessors: [
      new BatchSpanProcessor(
        new ListedAttributesSpanExporter(new OTLPTraceExporter({ url: endpoint })),
        {
          maxExportBatchSize: isProduction ? 200 : 50,
          scheduledDelayMillis: isProduction ? 2000 : 1000,
        },
      ),
    ],
    metricReaders: [
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({ url: endpoint }),
        exportIntervalMillis: isProduction ? 60000 : 10000,
      }),
    ],
    // Explicit: left to the SDK default, logs go by HTTP to the gRPC endpoint and are lost.
    logRecordProcessors: [
      new BatchLogRecordProcessor({ exporter: new OTLPLogExporter({ url: endpoint }) }),
    ],
    // The process and host detectors add the command line, the OS user and the pid to every record.
    autoDetectResources: false,
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: options.serviceName || 'unknown-service',
      [ATTR_SERVICE_VERSION]: options.serviceVersion || '0.0.0',
      'deployment.environment.name': options.environment || 'development',
    }),
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': { enabled: false },
        '@opentelemetry/instrumentation-dns': { enabled: false },
        '@opentelemetry/instrumentation-net': { enabled: false },
        // Disabled: adds a `finish` listener to ServerResponse per router layer per request.
        // NestJS has 11+ layers, exceeding Node's EventEmitter.defaultMaxListeners of 10.
        // HTTP instrumentation already covers request lifecycle tracing for NestJS/Apollo.
        '@opentelemetry/instrumentation-router': { enabled: false },
        '@opentelemetry/instrumentation-http': {
          ignoreIncomingRequestHook: (req) => isUntracedPath(req.url),
        },
        '@opentelemetry/instrumentation-ioredis': {
          dbStatementSerializer: serializeRedisCommand,
        },
      }),
    ],
  });
}
