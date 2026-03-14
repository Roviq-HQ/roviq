export interface NotificationConfigRecord {
  id: string;
  tenantId: string;
  notificationType: string;
  inAppEnabled: boolean;
  whatsappEnabled: boolean;
  emailEnabled: boolean;
  pushEnabled: boolean;
  digestEnabled: boolean;
  digestCron: string | null;
}

export interface UpsertNotificationConfigData {
  tenantId: string;
  notificationType: string;
  inAppEnabled?: boolean;
  whatsappEnabled?: boolean;
  emailEnabled?: boolean;
  pushEnabled?: boolean;
  digestEnabled?: boolean;
  digestCron?: string;
}
