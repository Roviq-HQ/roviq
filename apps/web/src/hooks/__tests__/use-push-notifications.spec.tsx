import { MockedProvider } from '@apollo/client/testing/react';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePushNotifications } from '../use-push-notifications';
import {
  RegisterDeviceTokenDocument,
  UnregisterDeviceTokenDocument,
} from '../use-push-notifications.generated';

const auth = vi.hoisted(() => ({ isImpersonated: false }));
vi.mock('@roviq/auth', () => ({ useAuth: () => ({ isImpersonated: auth.isImpersonated }) }));

const getFcmToken = vi.hoisted(() => vi.fn());
vi.mock('@roviq/ui/lib/firebase', () => ({ getFcmToken }));

const TOKEN = 'fcm-token-browser-1';

function setup() {
  const registered = vi.fn();
  const unregistered = vi.fn();
  const mocks = [
    {
      request: { query: RegisterDeviceTokenDocument, variables: { token: TOKEN, platform: 'WEB' } },
      result: () => {
        registered();
        return { data: { __typename: 'Mutation' as const, registerDeviceToken: true } };
      },
    },
    {
      request: { query: UnregisterDeviceTokenDocument, variables: { token: TOKEN } },
      result: () => {
        unregistered();
        return { data: { __typename: 'Mutation' as const, unregisterDeviceToken: true } };
      },
    },
  ];
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MockedProvider mocks={mocks}>{children}</MockedProvider>
  );
  return { registered, unregistered, ...renderHook(() => usePushNotifications(), { wrapper }) };
}

beforeEach(() => {
  auth.isImpersonated = false;
  getFcmToken.mockReset();
  vi.stubEnv('NEXT_PUBLIC_FIREBASE_VAPID_KEY', 'vapid-key');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('usePushNotifications', () => {
  it('registers the browser token and unregisters that token on logout', async () => {
    getFcmToken.mockResolvedValue(TOKEN);
    const { registered, unregistered, result } = setup();
    await waitFor(() => expect(registered).toHaveBeenCalledTimes(1));

    act(() => result.current.unregisterPushToken());

    await waitFor(() => expect(unregistered).toHaveBeenCalledTimes(1));
    // A second logout call has nothing left to unregister.
    act(() => result.current.unregisterPushToken());
    expect(unregistered).toHaveBeenCalledTimes(1);
  });

  it('sends nothing on logout when this browser registered no token', async () => {
    getFcmToken.mockResolvedValue(null);
    const { registered, unregistered, result } = setup();
    await waitFor(() => expect(getFcmToken).toHaveBeenCalledWith('vapid-key'));

    act(() => result.current.unregisterPushToken());

    expect(registered).not.toHaveBeenCalled();
    expect(unregistered).not.toHaveBeenCalled();
  });

  it('does not register a device for an impersonated session', () => {
    auth.isImpersonated = true;
    getFcmToken.mockResolvedValue(TOKEN);
    const { registered } = setup();

    expect(getFcmToken).not.toHaveBeenCalled();
    expect(registered).not.toHaveBeenCalled();
  });
});
