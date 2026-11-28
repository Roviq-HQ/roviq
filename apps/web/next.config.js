//@ts-check

const { composePlugins, withNx } = require('@nx/next');
const createNextIntlPlugin = require('next-intl/plugin');

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

async function headers() {
  return [
    {
      source: '/(.*)',
      headers: [
        { key: 'X-DNS-Prefetch-Control', value: 'on' },
        { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
      ],
    },
  ];
}

/**
 * @type {import('@nx/next/plugins/with-nx').WithNxOptions}
 **/
const nextConfig = {
  // Use this to set Nx-specific options
  // See: https://nx.dev/recipes/next/next-config-setup
  nx: {},
  output: process.env.STANDALONE === 'true' ? 'standalone' : undefined,
  headers,
  // Otherwise `next dev` writes an AGENTS.md into apps/web on every start.
  agentRules: false,
  experimental: {
    globalNotFound: true,
    // Persist Turbopack's computation graph (SWC transforms, RSC outputs,
    // module metadata) across `next build` runs. Wipe via
    // `pnpm dlx rimraf apps/web/.next` if a dep upgrade leaves a stale hit.
    turbopackFileSystemCacheForBuild: true,
    // Off for `next dev`: a start loads the whole disk cache into memory, so a restart frees
    // nothing. Without it a restart begins small (scripts/dev-web.sh restarts at a cap).
    turbopackFileSystemCacheForDev: false,
  },
};

const plugins = [
  // Add more Next.js plugins to this list if needed.
  withNx,
  withNextIntl,
];

module.exports = composePlugins(...plugins)(nextConfig);
