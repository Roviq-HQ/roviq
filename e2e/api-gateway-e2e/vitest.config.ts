import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    root: path.resolve(__dirname),
    include: ['src/**/*.e2e.test.ts'],
    testTimeout: 15000,
    globalSetup: './global-setup.ts',
  },
});
