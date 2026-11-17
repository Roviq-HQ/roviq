/**
 * For specs that switch institute: `switchInstitute` revokes the session's
 * refresh token server-side, so doing it on the shared `storageState` session
 * breaks every later test that sends that token (e.g. the Sessions page).
 * These specs start signed out and log in to a session of their own.
 */
import type { Page } from '@playwright/test';
import { LoginPage } from './pages/LoginPage';
import { E2E_USERS, SEED } from './seed-fixtures';

export const SIGNED_OUT_STORAGE_STATE = { cookies: [], origins: [] };

export async function loginWithOwnInstituteSession(page: Page): Promise<void> {
  const loginPage = new LoginPage(page);
  await loginPage.goto('/en/login');
  await loginPage.login(E2E_USERS.INSTITUTE_ADMIN.username, E2E_USERS.INSTITUTE_ADMIN.password);
  await loginPage.selectInstitute(SEED.INSTITUTE_1.name);
  await loginPage.expectRedirectToDashboard();
}
