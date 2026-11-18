import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@web/__test-utils__/render-with-providers';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ViewAsButton } from '../view-as-button';
import { CanImpersonateUserDocument } from '../view-as-button.generated';

const auth = vi.hoisted(() => ({ isImpersonated: false, userId: 'admin-1' }));
vi.mock('@roviq/auth', () => ({
  useAuth: () => ({
    user: { id: auth.userId, tenantId: 'tenant-1' },
    memberships: [{ tenantId: 'tenant-1', instituteName: { en: 'Saraswati Vidya Mandir' } }],
    isImpersonated: auth.isImpersonated,
  }),
}));

const TARGET = 'teacher-1';
const IMPERSONATOR = [
  { action: 'read' as const, subject: 'all' as const },
  { action: 'impersonate' as const, subject: 'User' as const },
];

function canMock(allowed: boolean, onCall?: () => void) {
  return {
    request: { query: CanImpersonateUserDocument, variables: { targetUserId: TARGET } },
    result: () => {
      onCall?.();
      return { data: { canImpersonateUser: allowed } };
    },
  };
}

const button = () => screen.queryByTestId(`impersonate-btn-${TARGET}`);

beforeEach(() => {
  auth.isImpersonated = false;
  auth.userId = 'admin-1';
});

describe('ViewAsButton', () => {
  it('appears once the server says this person can be viewed as, and opens the dialog', async () => {
    renderWithProviders(<ViewAsButton userId={TARGET} name="Rajesh Sharma" />, {
      apolloMocks: [canMock(true)],
      abilityRules: IMPERSONATOR,
    });

    expect(button()).not.toBeInTheDocument();
    await waitFor(() => expect(button()).toBeInTheDocument());
    await userEvent.click(button() as HTMLElement);

    const dialog = await screen.findByTestId('impersonation-dialog');
    expect(dialog).toHaveTextContent('View as Rajesh Sharma');
    expect(dialog).toHaveTextContent('Saraswati Vidya Mandir');
  });

  it('stays hidden for someone whose role is equal to or above the caller', async () => {
    const asked = vi.fn();
    renderWithProviders(<ViewAsButton userId={TARGET} name="Principal Rao" />, {
      apolloMocks: [canMock(false, asked)],
      abilityRules: IMPERSONATOR,
    });

    await waitFor(() => expect(asked).toHaveBeenCalled());
    expect(button()).not.toBeInTheDocument();
  });

  it.each([
    [
      'a role without the impersonate ability',
      () => undefined,
      [{ action: 'read' as const, subject: 'all' as const }],
    ],
    [
      'the signed-in user themselves',
      () => {
        auth.userId = TARGET;
      },
      IMPERSONATOR,
    ],
    [
      'a tab that is already impersonating',
      () => {
        auth.isImpersonated = true;
      },
      IMPERSONATOR,
    ],
  ])('does not even ask the server for %s', async (_case, arrange, abilityRules) => {
    arrange();
    const asked = vi.fn();
    renderWithProviders(<ViewAsButton userId={TARGET} name="Rajesh Sharma" />, {
      apolloMocks: [canMock(true, asked)],
      abilityRules,
    });

    // Give a wrongly fired query time to resolve.
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(asked).not.toHaveBeenCalled();
    expect(button()).not.toBeInTheDocument();
  });
});
