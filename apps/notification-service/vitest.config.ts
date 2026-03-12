import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@roviq/prisma-client': resolve(__dirname, '../../libs/backend/prisma-client/src/index.ts'),
      '@roviq/nats-utils': resolve(__dirname, '../../libs/backend/nats-utils/src/index.ts'),
      '@roviq/nestjs-prisma': resolve(__dirname, '../../libs/backend/nestjs-prisma/src/index.ts'),
      '@roviq/notifications': resolve(__dirname, '../../libs/backend/notifications/src/index.ts'),
      '@roviq/telemetry': resolve(__dirname, '../../libs/backend/telemetry/src/index.ts'),
      '@roviq/common-types': resolve(__dirname, '../../libs/shared/common-types/src/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
