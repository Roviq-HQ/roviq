//@ts-check

// The response headers every route of the web app carries. The Content-Security-Policy is
// not here: it holds a per-response nonce and is set by `src/middleware.ts`.

const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;

/**
 * @param {{ production: boolean }} options
 * @returns {Array<{ key: string, value: string }>}
 */
function securityHeaders({ production }) {
  return [
    { key: 'X-DNS-Prefetch-Control', value: 'on' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
    // A page keeps its own browsing context group; a tab it opens for another origin gets its own.
    { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
    // Scripts, styles and images of this app are for this origin's pages only.
    { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
    // Only where the site is served over HTTPS: on plain-HTTP localhost a browser would pin it.
    ...(production
      ? [
          {
            key: 'Strict-Transport-Security',
            value: `max-age=${ONE_YEAR_SECONDS}; includeSubDomains`,
          },
        ]
      : []),
  ];
}

module.exports = { securityHeaders };
