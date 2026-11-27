// The attributes a span or a span event may hold. An attribute that is not listed here is
// removed before the span leaves the process, and its name is recorded in
// `roviq.dropped_attributes` (docs/deployment.md → "Telemetry and shutdown").

import type { Attributes, AttributeValue } from '@opentelemetry/api';
import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-base';
import { withoutQueryValues } from './log-fields';

export const SPAN_ATTRIBUTES: ReadonlySet<string> = new Set([
  // HTTP, old and new names of the same facts: method, route, path, status, sizes.
  'http.method',
  'http.request.method',
  'http.route',
  'http.target',
  'http.url',
  'url.full',
  'url.path',
  'url.scheme',
  'http.scheme',
  'http.host',
  'http.flavor',
  'http.status_code',
  'http.status_text',
  'http.response.status_code',
  'http.request_content_length_uncompressed',
  'http.response_content_length_uncompressed',
  'network.protocol.version',
  'network.peer.address',
  'network.peer.port',
  'server.address',
  'server.port',
  'net.host.name',
  'net.host.port',
  'net.host.ip',
  'net.peer.name',
  'net.peer.port',
  'net.peer.ip',
  'net.transport',
  // The caller's address and browser. Personal data, kept on purpose for abuse reports.
  'client.address',
  'http.client_ip',
  'user_agent.original',
  'http.user_agent',
  // GraphQL: names and the document with every literal replaced by `*`. Never variables.
  'graphql.operation.name',
  'graphql.operation.type',
  'graphql.source',
  'graphql.field.name',
  'graphql.field.path',
  'graphql.field.type',
  'graphql.parent.name',
  // SQL and Redis: the statement with placeholders, the command name. Never values.
  'db.system',
  'db.system.name',
  'db.name',
  'db.namespace',
  'db.user',
  'db.operation',
  'db.operation.name',
  'db.statement',
  'db.query.text',
  'db.postgresql.idle.timeout.millis',
  'db.postgresql.max.client',
  // Framework and messaging names from the code.
  'component',
  'nestjs.type',
  'nestjs.controller',
  'nestjs.callback',
  'nestjs.module',
  'nestjs.version',
  'express.name',
  'express.type',
  'rpc.system',
  'rpc.service',
  'rpc.method',
  'rpc.grpc.status_code',
  'messaging.system',
  'messaging.operation',
  'messaging.destination.name',
  // Errors: type, message and stack, without query values.
  'error.type',
  'exception.type',
  'exception.message',
  'exception.stacktrace',
]);

export const DROPPED_ATTRIBUTES_KEY = 'roviq.dropped_attributes';

/** Attributes that hold an address: the query string is cut off. */
const ADDRESS_ATTRIBUTES: ReadonlySet<string> = new Set(['http.target', 'http.url', 'url.full']);

function listedValue(key: string, value: AttributeValue | undefined): AttributeValue | undefined {
  if (typeof value !== 'string') return value;
  if (ADDRESS_ATTRIBUTES.has(key)) return value.split('?', 1)[0];
  return withoutQueryValues(value);
}

/** Keep the listed attributes; `dropped` collects the names of the others. */
export function keepListedAttributes(attributes: Attributes, dropped: Set<string>): Attributes {
  const kept: Attributes = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (SPAN_ATTRIBUTES.has(key)) kept[key] = listedValue(key, value);
    else dropped.add(key);
  }
  return kept;
}

/** A view of `span` with listed attributes only, on the span, its events and its links. */
export function withListedAttributes(span: ReadableSpan): ReadableSpan {
  const dropped = new Set<string>();
  const attributes = keepListedAttributes(span.attributes, dropped);
  const events = span.events.map((event) => ({
    ...event,
    attributes: event.attributes ? keepListedAttributes(event.attributes, dropped) : undefined,
  }));
  const links = span.links.map((link) => ({
    ...link,
    attributes: link.attributes ? keepListedAttributes(link.attributes, dropped) : undefined,
  }));
  if (dropped.size > 0) attributes[DROPPED_ATTRIBUTES_KEY] = [...dropped].sort();
  return Object.create(span, {
    attributes: { value: attributes, enumerable: true },
    events: { value: events, enumerable: true },
    links: { value: links, enumerable: true },
  }) as ReadableSpan;
}

/** Passes every span on with its listed attributes only. */
export class ListedAttributesSpanExporter implements SpanExporter {
  constructor(private readonly inner: SpanExporter) {}

  export(spans: ReadableSpan[], resultCallback: Parameters<SpanExporter['export']>[1]): void {
    this.inner.export(spans.map(withListedAttributes), resultCallback);
  }

  shutdown(): Promise<void> {
    return this.inner.shutdown();
  }

  forceFlush(): Promise<void> {
    return this.inner.forceFlush?.() ?? Promise.resolve();
  }
}
