import { defineConfig, mergeConfig } from 'vitest/config';
import shared from '../../../vitest.shared';

export default mergeConfig(
  shared,
  defineConfig({
    test: {
      include: ['src/**/*.spec.ts'],
      exclude: ['**/*.integration.spec.ts', '**/node_modules/**'],
      // Types and constants only since the Novu code left; a spec added later still runs.
      passWithNoTests: true,
    },
  }),
);
