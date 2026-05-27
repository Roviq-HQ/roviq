import { metrics } from '@opentelemetry/api';
import { getAllCircuitBreakers } from './circuit-breaker';

/** 0 = closed, 1 = half-open, 2 = open. */
export function circuitBreakerStateValue(b: { opened: boolean; halfOpen: boolean }): number {
  if (b.opened) return 2;
  if (b.halfOpen) return 1;
  return 0;
}

export function registerCircuitBreakerGauge(): void {
  const meter = metrics.getMeter('resilience');
  meter
    .createObservableGauge('circuit_breaker_state', {
      description: 'Circuit breaker state (0 closed, 1 half-open, 2 open)',
    })
    .addCallback((result) => {
      for (const [name, breaker] of getAllCircuitBreakers()) {
        result.observe(circuitBreakerStateValue(breaker), { name });
      }
    });
}
