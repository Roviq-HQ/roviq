import { Inject, Injectable } from '@nestjs/common';
import { TENANT_PRISMA_CLIENT } from '@roviq/nestjs-prisma';
import type { TenantPrismaClient } from '@roviq/prisma-client';
import { NotificationConfigRepository } from './notification-config.repository';
import type { NotificationConfigRecord, UpsertNotificationConfigData } from './types';

@Injectable()
export class NotificationConfigPrismaRepository extends NotificationConfigRepository {
  constructor(@Inject(TENANT_PRISMA_CLIENT) private readonly tenantPrisma: TenantPrismaClient) {
    super();
  }

  findAll(): Promise<NotificationConfigRecord[]> {
    return this.tenantPrisma.instituteNotificationConfig.findMany({
      orderBy: { notificationType: 'asc' },
    }) as Promise<NotificationConfigRecord[]>;
  }

  async upsert(data: UpsertNotificationConfigData): Promise<NotificationConfigRecord> {
    const { tenantId, notificationType, ...rest } = data;

    const config = await this.tenantPrisma.instituteNotificationConfig.upsert({
      where: {
        tenantId_notificationType: {
          tenantId,
          notificationType,
        },
      },
      update: rest,
      create: {
        tenantId,
        notificationType,
        ...rest,
      },
    });

    return config as unknown as NotificationConfigRecord;
  }
}
