import { EVENT_PATTERNS } from '@roviq/nats-jetstream';
import { describe, expect, it } from 'vitest';
import { gatewayConsumer } from '../gateway-consumer';

describe('gatewayConsumer', () => {
  it('should name the stream and a gateway durable in kebab case', () => {
    expect(gatewayConsumer(EVENT_PATTERNS.ACADEMIC_YEAR.activated)).toEqual({
      stream: 'ACADEMIC_YEAR',
      durable: 'gateway-academic-year-activated',
    });
    expect(gatewayConsumer(EVENT_PATTERNS.STUDENT.section_changed)).toEqual({
      stream: 'STUDENT',
      durable: 'gateway-student-section-changed',
    });
  });
});
