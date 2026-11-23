import { NotificationChannel } from '@roviq/common-types';

/** Adapter name stored in `messaging_senders.provider`; the notification service matches on it. */
export const WHATSAPP_CLOUD_PROVIDER = 'whatsapp_cloud';

/** Senders exist only for WhatsApp today. */
export const MESSAGING_SENDER_CHANNEL = NotificationChannel.WHATSAPP;

/** Usage is counted by the calendar month in this timezone. */
export const USAGE_TIMEZONE = 'Asia/Kolkata';
