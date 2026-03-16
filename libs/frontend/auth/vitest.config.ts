import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: [
      {
        find: '@roviq/common-types',
        replacement: path.resolve(__dirname, '../../shared/common-types/src/index.ts'),
      },
      { find: '@roviq/auth', replacement: path.resolve(__dirname, 'src/index.ts') },
      { find: /^@roviq\/ui\/(.+)$/, replacement: path.resolve(__dirname, '../ui/src/$1') },
      { find: '@roviq/ui', replacement: path.resolve(__dirname, '../ui/src/index.ts') },
      // Only alias config — full @roviq/i18n barrel pulls in next-intl/next/server which won't resolve in Vitest
      { find: '@roviq/i18n', replacement: path.resolve(__dirname, '../i18n/src/lib/config.ts') },
    ],
  },
  test: {
    globals: true,
    environment: 'happy-dom',
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
