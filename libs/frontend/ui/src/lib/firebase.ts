import { getApps, initializeApp } from 'firebase/app';
import {
  getMessaging,
  getToken,
  isSupported,
  type MessagePayload,
  onMessage,
} from 'firebase/messaging';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

function getFirebaseApp() {
  if (getApps().length > 0) return getApps()[0];
  return initializeApp(firebaseConfig);
}

/**
 * Registers the Firebase messaging service worker, passing Firebase config as
 * URL query params so the SW can initialise without access to process.env.
 */
async function registerServiceWorker(): Promise<ServiceWorkerRegistration> {
  const { apiKey, projectId, messagingSenderId, appId } = firebaseConfig;
  const params = new URLSearchParams({
    apiKey: apiKey ?? '',
    projectId: projectId ?? '',
    messagingSenderId: messagingSenderId ?? '',
    appId: appId ?? '',
  });
  return navigator.serviceWorker.register(`/firebase-messaging-sw.js?${params.toString()}`);
}

export async function getFcmToken(vapidKey: string): Promise<string | null> {
  const supported = await isSupported();
  if (!supported) return null;

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return null;

  const app = getFirebaseApp();
  const messaging = getMessaging(app);
  const serviceWorkerRegistration = await registerServiceWorker();
  return getToken(messaging, { vapidKey, serviceWorkerRegistration });
}

export function onForegroundMessage(callback: (payload: MessagePayload) => void) {
  const app = getFirebaseApp();
  const messaging = getMessaging(app);
  return onMessage(messaging, callback);
}

/** Posted by the service worker to open pages when it shows a push in the background. */
export const PUSH_SHOWN_MESSAGE = 'roviq:push-shown';

function shownNotificationId(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return null;
  if (!('type' in data) || data.type !== PUSH_SHOWN_MESSAGE) return null;
  return 'notificationId' in data && typeof data.notificationId === 'string'
    ? data.notificationId
    : null;
}

/**
 * Calls back with the notification id of every push this browser shows: in the foreground
 * straight from the messaging SDK, in the background relayed by the service worker (which has
 * no session of its own). Returns the function that stops listening.
 */
export async function onPushShown(callback: (notificationId: string) => void): Promise<() => void> {
  if (!(await isSupported())) return () => undefined;
  const stopForeground = onForegroundMessage((payload) => {
    const id = payload.data?.notificationId;
    if (id) callback(id);
  });
  const fromWorker = (event: MessageEvent) => {
    const id = shownNotificationId(event.data);
    if (id) callback(id);
  };
  navigator.serviceWorker.addEventListener('message', fromWorker);
  return () => {
    stopForeground();
    navigator.serviceWorker.removeEventListener('message', fromWorker);
  };
}
