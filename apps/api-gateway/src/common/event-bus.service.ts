/**
 * Shared event bus service that publishes events to both:
 * 1. NATS JetStream — for inter-service communication
 * 2. GraphQL PubSub — for real-time client subscriptions
 *
 * This avoids duplicating emit + publish logic in every service.
 * All domain services should inject EventBusService instead of
 * using ClientProxy + pubSub directly.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ClientProxy } from '@nestjs/microservices';
import { pubSub } from './pubsub';

@Injectable()
export class EventBusService {
  private readonly logger = new Logger(EventBusService.name);

  constructor(@Inject('JETSTREAM_CLIENT') private readonly natsClient: ClientProxy) {}

  /**
   * Emit an event to both NATS and GraphQL PubSub.
   *
   * @param pattern - NATS-style dot-separated pattern (e.g. 'INSTITUTE.created')
   * @param data    - Event payload
   */
  emit(pattern: string, data: Record<string, unknown>): void {
    // 1. Publish to NATS for inter-service consumers
    this.natsClient.emit(pattern, data).subscribe({
      error: (err) => this.logger.warn(`Failed to emit ${pattern}`, err),
    });

    // 2. Publish to GraphQL PubSub for real-time subscriptions
    const subscriptionField = this.toSubscriptionKey(pattern);
    pubSub.publish(pattern, { [subscriptionField]: data });
  }

  /**
   * Convert a NATS dot-separated pattern to a camelCase GraphQL
   * subscription field name.
   *
   * Examples:
   *   'INSTITUTE.created'          → 'instituteCreated'
   *   'INSTITUTE.branding_updated' → 'instituteBrandingUpdated'
   *   'ACADEMIC_YEAR.activated'    → 'academicYearActivated'
   *   'SECTION.teacher_assigned'   → 'sectionTeacherAssigned'
   */
  private toSubscriptionKey(pattern: string): string {
    const [rawEntity, rawAction] = pattern.split('.');

    // Convert UPPER_SNAKE entity to camelCase: ACADEMIC_YEAR → academicYear
    const entity = rawEntity.toLowerCase().replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

    // Convert snake_case action to PascalCase: branding_updated → BrandingUpdated
    const action = rawAction.replace(/(^|_)([a-z])/g, (_, _sep: string, c: string) =>
      c.toUpperCase(),
    );

    return `${entity}${action}`;
  }
}
