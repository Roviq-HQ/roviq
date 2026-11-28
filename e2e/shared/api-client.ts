/**
 * Minimal API-client helpers for Playwright tests that need to clean up
 * persistent data they created through the UI.
 *
 * Auth: reads the scope-appropriate access token from the browser's
 * `sessionStorage` (restored from the `auth.setup.ts` capture) and sends it as
 * `Authorization: Bearer …`. Cookies are NOT used for API auth in this
 * stack, so `page.request` without an explicit header is anonymous.
 *
 * Scope: the institute web app stores its token under
 * `__e2e_session__roviq-institute-access-token`; other scopes use the
 * equivalent `-platform-` / `-reseller-` keys. We currently only need the
 * institute scope, so that is the sole export — add more when required.
 */

import type { Page } from '@playwright/test';

const API_URL =
  process.env.API_URL || `http://localhost:${process.env.E2E_API_PORT ?? '3004'}/api/graphql`;
const INSTITUTE_SESSION_KEY = 'roviq-institute-access-token';
const INSTITUTE_TOKEN_KEY = `__e2e_session__${INSTITUTE_SESSION_KEY}`;

// The page fixture moves captured tokens back into sessionStorage on load, so the
// prefixed localStorage copy only exists before the first navigation.
async function instituteAccessToken(page: Page): Promise<string | null> {
  // A cleanup hook can run while the test's last navigation is still under way, and a script
  // evaluated in a page that is being replaced is thrown away with it.
  await page.waitForLoadState('domcontentloaded');
  return page.evaluate(
    ([sessionKey, capturedKey]) =>
      window.sessionStorage.getItem(sessionKey) ?? window.localStorage.getItem(capturedKey),
    [INSTITUTE_SESSION_KEY, INSTITUTE_TOKEN_KEY],
  );
}

/**
 * Deletes a student by id via the `deleteStudent` GraphQL mutation using
 * the active institute session. Swallows failures (logs to console) so a
 * cleanup hook never masks the actual test failure it's running after.
 */
export async function deleteStudentViaApi(page: Page, studentId: string): Promise<void> {
  const token = await instituteAccessToken(page);
  if (!token) {
    console.warn(`[cleanup] no institute access token — skipping deleteStudent(${studentId})`);
    return;
  }
  try {
    const res = await page.request.post(API_URL, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      data: {
        query: /* GraphQL */ `mutation DeleteStudentCleanup($id: ID!) { deleteStudent(id: $id) }`,
        variables: { id: studentId },
      },
    });
    if (!res.ok()) {
      console.warn(`[cleanup] deleteStudent(${studentId}) → HTTP ${res.status()}`);
    }
  } catch (err) {
    console.warn(`[cleanup] deleteStudent(${studentId}) threw:`, err);
  }
}

/**
 * Extracts the UUID from the students detail URL (`/people/students/{uuid}`
 * or the middleware-rewritten `/institute/people/students/{uuid}`). Returns
 * null when the URL does not match — callers should log that so they can
 * skip cleanup cleanly.
 */
export function extractStudentIdFromUrl(url: string): string | null {
  const match = url.match(/\/students\/([0-9a-f-]{36})(?:[/?#]|$)/);
  return match?.[1] ?? null;
}

/**
 * Runs a GraphQL operation as the signed-in institute user. Throws on GraphQL
 * errors so a broken setup step fails the test where it happens.
 */
export async function instituteGraphql<TData>(
  page: Page,
  query: string,
  variables: Record<string, unknown>,
): Promise<TData> {
  const token = await instituteAccessToken(page);
  if (!token) throw new Error('No institute access token in localStorage');
  const res = await page.request.post(API_URL, {
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    data: { query, variables },
  });
  const body: { data?: TData; errors?: Array<{ message: string }> } = await res.json();
  if (body.errors?.length || !body.data) {
    throw new Error(`GraphQL setup call failed: ${JSON.stringify(body.errors ?? body)}`);
  }
  return body.data;
}
