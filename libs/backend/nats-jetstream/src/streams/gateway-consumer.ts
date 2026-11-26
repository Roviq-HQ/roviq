import type { EventPattern } from './event-patterns';
import { STREAMS } from './stream.config';

/** The `@EventPattern` extras of a gateway consumer: its stream and durable name. */
export interface GatewayConsumer {
  stream: string;
  durable: string;
}

/**
 * The one consumer the gateway keeps for `pattern`. Workqueue streams allow one consumer per
 * subject, so every gateway handler of a subject must use this.
 */
export function gatewayConsumer(pattern: EventPattern): GatewayConsumer {
  const [prefix] = pattern.split('.');
  const stream = Object.values(STREAMS).find((s) => s.subjects.includes(`${prefix}.>`));
  if (!stream) throw new Error(`No JetStream stream carries "${pattern}"`);
  return {
    stream: stream.name,
    durable: `gateway-${pattern.toLowerCase().replace(/[._]/g, '-')}`,
  };
}
