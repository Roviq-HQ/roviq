import { defineConfig, mergeConfig } from 'vitest/config';
import shared from '../../../vitest.shared';

export default mergeConfig(
  shared,
  defineConfig({
    test: {
      include: ['libs/backend/nats-jetstream/src/**/*.integration.spec.ts'],
      testTimeout: 15_000,
      hookTimeout: 15_000,
    },
  }),
);
