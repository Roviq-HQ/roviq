import { Injectable } from '@nestjs/common';
import type { UpdateNotificationConfigInput } from './dto/update-notification-config.input';
import { NotificationConfigRepository } from './repositories/notification-config.repository';
import type { NotificationConfigRecord } from './repositories/types';

@Injectable()
export class NotificationConfigService {
  constructor(private readonly notificationConfigRepo: NotificationConfigRepository) {}

  async findAll(): Promise<NotificationConfigRecord[]> {
    return this.notificationConfigRepo.findAll();
  }

  async update(
    tenantId: string,
    input: UpdateNotificationConfigInput,
  ): Promise<NotificationConfigRecord> {
    const { notificationType, ...data } = input;

    const config = await this.notificationConfigRepo.upsert({
      tenantId,
      notificationType,
      ...data,
    });

    return config;
  }
}
