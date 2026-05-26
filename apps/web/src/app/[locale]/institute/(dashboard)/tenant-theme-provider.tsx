'use client';

import { gql, useQuery } from '@roviq/graphql';
import { buildTenantThemeCss } from '@roviq/ui';
import { useEffect } from 'react';

/**
 * Applies the current institute's brand colour as the app accent at runtime
 * (ROV-17). Mounted ONLY inside the institute dashboard layout, so the
 * platform-admin and reseller scopes keep the Roviq default theme. Re-skinning
 * lives in a single injected <style> block (see buildTenantThemeCss) covering
 * light + dark; next-themes' class toggle picks the right values for free.
 *
 * On unmount (navigating out of the institute scope, or institute switch which
 * reloads the app) the style element is removed, so the accent never leaks
 * into another scope or a stale tenant.
 */

const STYLE_ELEMENT_ID = 'roviq-tenant-theme';

const TENANT_THEME_QUERY = gql`
  query TenantTheme {
    myInstitute {
      id
      branding {
        id
        primaryColor
      }
    }
  }
`;

/**
 * Result shape for TENANT_THEME_QUERY. Hand-rolled rather than imported from
 * the gitignored codegen sibling, so `pnpm typecheck` doesn't depend on codegen
 * having run first (matches use-billing / use-institute-settings). The gql
 * operation is still schema-validated by codegen + the drift gate.
 */
interface TenantThemeData {
  myInstitute: {
    id: string;
    branding: { id: string; primaryColor: string | null } | null;
  } | null;
}

/**
 * Set or clear the tenant-theme <style> in <head>. Exported so the branding
 * settings editor can reuse the exact same injection for live preview, then
 * clear it on unmount — one code path, no drift.
 */
export function applyTenantTheme(primaryColor: string | null | undefined): void {
  if (typeof document === 'undefined') return;
  const css = buildTenantThemeCss(primaryColor);
  const existing = document.getElementById(STYLE_ELEMENT_ID);
  if (!css) {
    existing?.remove();
    return;
  }
  const el = existing ?? document.createElement('style');
  el.id = STYLE_ELEMENT_ID;
  el.textContent = css;
  if (!existing) document.head.appendChild(el);
}

export function clearTenantTheme(): void {
  if (typeof document === 'undefined') return;
  document.getElementById(STYLE_ELEMENT_ID)?.remove();
}

export function TenantThemeProvider({ children }: { children: React.ReactNode }) {
  const { data } = useQuery<TenantThemeData>(TENANT_THEME_QUERY, {
    fetchPolicy: 'cache-and-network',
  });
  const primaryColor = data?.myInstitute?.branding?.primaryColor ?? null;

  useEffect(() => {
    applyTenantTheme(primaryColor);
    return clearTenantTheme;
  }, [primaryColor]);

  return <>{children}</>;
}
