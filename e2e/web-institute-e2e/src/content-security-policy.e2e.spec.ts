// Not the console guardian's `test`: these tests make the browser refuse a script on purpose,
// and the guardian fails a test on the console error that refusal writes. Every other spec
// runs under the guardian, so a policy violation on any toured page fails that spec.
import { expect, test } from '@playwright/test';
import { addSessionRestoreInitScript } from '../../shared/auth-helpers';

test.describe('Content security policy', () => {
  // What the guardian's page fixture does: without the saved access token the app would
  // refresh the session, and a refresh retires the token every other spec starts from.
  test.beforeEach(async ({ context }) => {
    await addSessionRestoreInitScript(context);
  });

  test('sends a policy with a nonce, and no inline scripts as a class', async ({ page }) => {
    const response = await page.goto('/en/dashboard');
    const policy = response?.headers()['content-security-policy'] ?? '';

    expect(policy).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+'(;|$)/);
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("object-src 'none'");
    // The production build: no eval either.
    expect(policy).not.toContain('unsafe-eval');
  });

  test('does not run a script or an event handler injected into the page', async ({ page }) => {
    await page.goto('/en/dashboard');
    await expect(page.getByTestId('dashboard-welcome-card')).toBeVisible({ timeout: 15_000 });

    const result = await page.evaluate(async () => {
      const refused: string[] = [];
      document.addEventListener('securitypolicyviolation', (event) => {
        refused.push(event.effectiveDirective);
      });
      const script = document.createElement('script');
      script.textContent = "window.__injectedScript = 'ran'";
      document.body.appendChild(script);

      const image = document.createElement('img');
      image.setAttribute('onerror', "window.__injectedHandler = 'ran'");
      image.src = 'data:image/png;base64,AAAA';
      document.body.appendChild(image);

      await new Promise((resolve) => setTimeout(resolve, 500));
      return {
        script: String(Reflect.get(window, '__injectedScript') ?? 'did not run'),
        handler: String(Reflect.get(window, '__injectedHandler') ?? 'did not run'),
        refused,
      };
    });

    expect(result.script).toBe('did not run');
    expect(result.handler).toBe('did not run');
    expect(result.refused).toEqual(expect.arrayContaining(['script-src-elem', 'script-src-attr']));
  });

  test('answers another portal’s path with the 404 page', async ({ page }) => {
    for (const path of ['/en/admin/login', '/en/admin/dashboard', '/en/reseller/institutes']) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(404);
    }
  });
});
