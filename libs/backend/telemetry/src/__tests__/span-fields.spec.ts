import { SpanStatusCode } from '@opentelemetry/api';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { describe, expect, it } from 'vitest';
import {
  DROPPED_ATTRIBUTES_KEY,
  ListedAttributesSpanExporter,
  SPAN_ATTRIBUTES,
} from '../span-fields';

const PHONE = '9876500011';
const PASSWORD = 'Marker#Pass1';

/** Real spans, exported through the listed-attributes exporter into memory. */
function tracing() {
  const memory = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(new ListedAttributesSpanExporter(memory))],
  });
  return { tracer: provider.getTracer('test'), finished: () => memory.getFinishedSpans() };
}

describe('ListedAttributesSpanExporter', () => {
  it('should export listed attributes and name the dropped ones', () => {
    const { tracer, finished } = tracing();

    const span = tracer.startSpan('POST /api/graphql');
    span.setAttributes({
      'http.request.method': 'POST',
      'http.route': '/api/graphql',
      'graphql.variables.phone': PHONE,
      'http.request.header.authorization': `Bearer ${PASSWORD}`,
      'http.request.header.cookie': `refresh=${PASSWORD}`,
    });
    span.end();

    const [exported] = finished();
    expect(exported?.attributes).toEqual({
      'http.request.method': 'POST',
      'http.route': '/api/graphql',
      [DROPPED_ATTRIBUTES_KEY]: [
        'graphql.variables.phone',
        'http.request.header.authorization',
        'http.request.header.cookie',
      ],
    });
    expect(JSON.stringify(exported?.attributes)).not.toMatch(new RegExp(`${PHONE}|${PASSWORD}`));
  });

  it('should cut the query string of an address', () => {
    const { tracer, finished } = tracing();

    const span = tracer.startSpan('GET');
    span.setAttributes({
      'url.full': `https://api.example.in/api/files?code=${PASSWORD}`,
      'http.target': `/api/files?code=${PASSWORD}`,
      'url.query': `code=${PASSWORD}`,
    });
    span.end();

    expect(finished()[0]?.attributes).toEqual({
      'url.full': 'https://api.example.in/api/files',
      'http.target': '/api/files',
      [DROPPED_ATTRIBUTES_KEY]: ['url.query'],
    });
  });

  it('should export a recorded exception without the values of a failed query', () => {
    const { tracer, finished } = tracing();

    const span = tracer.startSpan('pg.query');
    span.recordException(new Error(`Failed query: select $1\nparams: ${PHONE}`));
    span.addEvent('retry', { 'retry.payload': PHONE });
    span.setStatus({ code: SpanStatusCode.ERROR });
    span.end();

    const [exported] = finished();
    expect(exported?.events.map((event) => event.name)).toEqual(['exception', 'retry']);
    expect(exported?.events[0]?.attributes?.['exception.message']).toBe(
      'Failed query: select $1\nparams: [values not logged]',
    );
    expect(exported?.events[1]?.attributes).toEqual({});
    expect(JSON.stringify(exported?.events)).not.toContain(PHONE);
  });

  it('should keep the identity, timing and status of the span', () => {
    const { tracer, finished } = tracing();

    const span = tracer.startSpan('GET /api/health');
    span.setStatus({ code: SpanStatusCode.ERROR, message: 'down' });
    span.end();

    const [exported] = finished();
    expect(exported?.name).toBe('GET /api/health');
    expect(exported?.spanContext().traceId).toBe(span.spanContext().traceId);
    expect(exported?.status).toEqual({ code: SpanStatusCode.ERROR, message: 'down' });
    expect(exported?.endTime).toBeDefined();
  });

  it('should list no attribute that holds a header, a variable, a cookie or a body', () => {
    const banned = /header|cookie|variable|body|authorization|password/i;
    expect([...SPAN_ATTRIBUTES].filter((name) => banned.test(name))).toEqual([]);
  });
});
