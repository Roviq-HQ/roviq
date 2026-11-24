import { MockedProvider } from '@apollo/client/testing/react';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePushNotifications } from '../use-push-notifications';
import {
  AcknowledgeNotificationDeliveryDocument,
  RegisterDeviceTokenDocument,
  UnregisterDeviceTokenDocument,
} from '../use-push-notifications.generated';

const auth = vi.hoisted(() => ({ isImpersonated: false }));
vi.mock('@roviq/auth', () => ({ useAuth: () => ({ isImpersonated: auth.isImpersonated }) }));

const getFcmToken = vi.hoisted(() => vi.fn());
const push = vi.hoisted(() => ({
  shown: null as ((notificationId: string) => void) | null,
  stop: vi.fn(),
}));
vi.mock('@roviq/ui/lib/firebase', () => ({
  getFcmToken,
  onPushShown: vi.fn(async (callback: (notificationId: string) => void) => {
    push.shown = callback;
    return push.stop;
  }),
}));

const TOKEN = 'fcm-token-browser-1';
const NOTIFICATION = '019a0000-0000-7000-8000-00000000000a';

function setup() {
  const registered = vi.fn();
  const unregistered = vi.fn();
  const acknowledged = vi.fn();
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
    {
      request: {
        query: AcknowledgeNotificationDeliveryDocument,
        variables: { notificationId: NOTIFICATION },
      },
      result: () => {
        acknowledged();
        return { data: { __typename: 'Mutation' as const, acknowledgeNotificationDelivery: true } };
      },
    },
  ];
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MockedProvider mocks={mocks}>{children}</MockedProvider>
  );
  return {
    registered,
    unregistered,
    acknowledged,
    ...renderHook(() => usePushNotifications(), { wrapper }),
  };
}

beforeEach(() => {
  auth.isImpersonated = false;
  getFcmToken.mockReset();
  push.shown = null;
  push.stop.mockReset();
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

  it('acknowledges a push this browser shows, and stops listening on unmount', async () => {
    getFcmToken.mockResolvedValue(null);
    const { acknowledged, unmount } = setup();
    await waitFor(() => expect(push.shown).not.toBeNull());

    act(() => push.shown?.(NOTIFICATION));

    await waitFor(() => expect(acknowledged).toHaveBeenCalledTimes(1));
    unmount();
    expect(push.stop).toHaveBeenCalledTimes(1);
  });

  it('does not listen for shown pushes in an impersonated session', () => {
    auth.isImpersonated = true;
    setup();

    expect(push.shown).toBeNull();
  });
});
