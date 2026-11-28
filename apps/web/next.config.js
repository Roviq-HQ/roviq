//@ts-check

const { composePlugins, withNx } = require('@nx/next');
const createNextIntlPlugin = require('next-intl/plugin');

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const { securityHeaders } = require('./security-headers');

async function headers() {
  return [
    {
      source: '/(.*)',
      headers: securityHeaders({ production: process.env.NODE_ENV === 'production' }),
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
  poweredByHeader: false,
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
