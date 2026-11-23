'use client';

import { useAuth } from '@roviq/auth';
import { gql, useMutation } from '@roviq/graphql';
import { getFcmToken, onPushShown } from '@roviq/ui/lib/firebase';
import { useCallback, useEffect, useRef } from 'react';
import {
  AcknowledgeNotificationDeliveryDocument,
  RegisterDeviceTokenDocument,
  UnregisterDeviceTokenDocument,
} from './use-push-notifications.generated';

export const REGISTER_DEVICE_TOKEN = gql`
  mutation RegisterDeviceToken($token: String!, $platform: DevicePlatform!) {
    registerDeviceToken(token: $token, platform: $platform)
  }
`;

export const UNREGISTER_DEVICE_TOKEN = gql`
  mutation UnregisterDeviceToken($token: String!) {
    unregisterDeviceToken(token: $token)
  }
`;

export const ACKNOWLEDGE_NOTIFICATION_DELIVERY = gql`
  mutation AcknowledgeNotificationDelivery($notificationId: ID!) {
    acknowledgeNotificationDelivery(notificationId: $notificationId)
  }
`;

/**
 * Registers this browser's push token for the signed-in user. Call `unregisterPushToken`
 * just before logging out so the next person on this browser does not get their pushes.
 * Each push the browser shows is acknowledged, so the server sends no WhatsApp or SMS for it.
 */
export function usePushNotifications() {
  const { isImpersonated } = useAuth();
  const [registerToken] = useMutation(RegisterDeviceTokenDocument);
  const [unregisterToken] = useMutation(UnregisterDeviceTokenDocument);
  const [acknowledge] = useMutation(AcknowledgeNotificationDeliveryDocument);
  const registered = useRef<string | null>(null);
  const requested = useRef(false);

  useEffect(() => {
    // An impersonated session may not register devices; the server refuses it.
    if (requested.current || isImpersonated) return;
    const vapidKey = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY;
    if (!vapidKey) return;
    requested.current = true;

    getFcmToken(vapidKey)
      .then(async (token) => {
        if (!token) return;
        await registerToken({ variables: { token, platform: 'WEB' } });
        registered.current = token;
      })
      .catch(() => {
        // Permission denied, push unsupported, or registration refused: the app works without push.
      });
  }, [registerToken, isImpersonated]);

  useEffect(() => {
    // An impersonated session is not the recipient's own device.
    if (isImpersonated) return;
    let stop: (() => void) | null = null;
    let cancelled = false;
    onPushShown((notificationId) => {
      // Best effort: a refused or failed acknowledgement only means the next channel is tried.
      acknowledge({ variables: { notificationId } }).catch(() => undefined);
    })
      .then((unsubscribe) => {
        if (cancelled) unsubscribe();
        else stop = unsubscribe;
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [acknowledge, isImpersonated]);

  const unregisterPushToken = useCallback(() => {
    const token = registered.current;
    if (!token) return;
    registered.current = null;
    // Best effort: logout neither waits for nor fails on it.
    unregisterToken({ variables: { token } }).catch(() => undefined);
  }, [unregisterToken]);

  return { unregisterPushToken };
}
