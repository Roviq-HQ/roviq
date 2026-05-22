// scripts/guards.ts
// Refuse to run destructive seed tiers (demo, e2e) in production. Roviq's
// dev DB shares the name 'roviq' with prod, so we cannot use a DB-name
// allowlist — NODE_ENV is the authoritative signal.
export function assertSafeToRunDestructiveSeed(): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'Refusing to run a destructive seed tier in production. ' +
        'NODE_ENV must not be "production".',
    );
  }
}
