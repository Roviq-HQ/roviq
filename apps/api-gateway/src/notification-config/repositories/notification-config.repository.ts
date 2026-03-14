import type { NotificationConfigRecord, UpsertNotificationConfigData } from './types';

export abstract class NotificationConfigRepository {
  abstract findAll(): Promise<NotificationConfigRecord[]>;
  abstract upsert(data: UpsertNotificationConfigData): Promise<NotificationConfigRecord>;
}
