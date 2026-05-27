/**
 * ROV-144 — Component tests for the impersonator scope multi-select filter.
 *
 * Uses the real nuqs state via NuqsTestingAdapter so toggling actually updates
 * the URL-backed state and re-renders aria-pressed. Translations come from the
 * full en bundle (renderWithProviders throws on any missing key, which also
 * asserts the new auditLogs.scopes/filters.impersonatorScope keys exist).
 */
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NuqsTestingAdapter } from 'nuqs/adapters/testing';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '../../../../../../__test-utils__/render-with-providers';
import { ImpersonationScopeFilter } from '../impersonation-scope-filter';

function renderFilter(search = ''): void {
  renderWithProviders(
    <NuqsTestingAdapter searchParams={search}>
      <ImpersonationScopeFilter />
    </NuqsTestingAdapter>,
  );
}

const scopeButton = (name: RegExp) => screen.getByRole('button', { name });

describe('ImpersonationScopeFilter', () => {
  it('renders a toggle for each scope, all unpressed by default', () => {
    renderFilter();

    expect(scopeButton(/platform/i)).toHaveAttribute('aria-pressed', 'false');
    expect(scopeButton(/reseller/i)).toHaveAttribute('aria-pressed', 'false');
    expect(scopeButton(/institute/i)).toHaveAttribute('aria-pressed', 'false');
  });

  it('reflects scopes already present in the URL as pressed', () => {
    renderFilter('?impScope=platform');

    expect(scopeButton(/platform/i)).toHaveAttribute('aria-pressed', 'true');
    expect(scopeButton(/reseller/i)).toHaveAttribute('aria-pressed', 'false');
  });

  it('toggles a scope on and back off when clicked', async () => {
    const user = userEvent.setup();
    renderFilter();

    await user.click(scopeButton(/institute/i));
    expect(scopeButton(/institute/i)).toHaveAttribute('aria-pressed', 'true');

    await user.click(scopeButton(/institute/i));
    expect(scopeButton(/institute/i)).toHaveAttribute('aria-pressed', 'false');
  });

  it('supports selecting multiple scopes at once', async () => {
    const user = userEvent.setup();
    renderFilter();

    await user.click(scopeButton(/platform/i));
    await user.click(scopeButton(/reseller/i));

    expect(scopeButton(/platform/i)).toHaveAttribute('aria-pressed', 'true');
    expect(scopeButton(/reseller/i)).toHaveAttribute('aria-pressed', 'true');
    expect(scopeButton(/institute/i)).toHaveAttribute('aria-pressed', 'false');
  });
});
