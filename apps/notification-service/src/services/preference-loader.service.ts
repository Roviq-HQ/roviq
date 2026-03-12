import { Inject, Injectable, Logger } from '@nestjs/common';
import { TENANT_PRISMA_CLIENT } from '@roviq/nestjs-prisma';
import type { TenantPrismaClient } from '@roviq/prisma-client';

export interface ChannelConfig {
  inApp: boolean;
  whatsapp: boolean;
  email: boolean;
  push: boolean;
  digest: boolean;
  digestCron?: string;
}

const DEFAULT_CONFIG: ChannelConfig = {
  inApp: true,
  whatsapp: true,
  email: true,
  push: false,
  digest: false,
};

@Injectable()
export class PreferenceLoaderService {
  private readonly logger = new Logger(PreferenceLoaderService.name);

  constructor(@Inject(TENANT_PRISMA_CLIENT) private readonly prisma: TenantPrismaClient) {}

  /**
   * Loads per-institute notification channel configuration from the database.
   * Falls back to sensible defaults if no config is found for the given tenant + type.
   *
   * IMPORTANT: Caller must wrap this in `tenantContext.run({ tenantId }, ...)` for RLS to work.
   */
  async loadConfig(tenantId: string, notificationType: string): Promise<ChannelConfig> {
    const config = await this.prisma.instituteNotificationConfig.findUnique({
      where: {
        tenantId_notificationType: { tenantId, notificationType },
      },
    });

    if (!config) {
      this.logger.debug(
        `No config found for tenant "${tenantId}" type "${notificationType}", using defaults`,
      );
      return { ...DEFAULT_CONFIG };
    }

    return {
      inApp: config.inAppEnabled,
      whatsapp: config.whatsappEnabled,
      email: config.emailEnabled,
      push: config.pushEnabled,
      digest: config.digestEnabled,
      digestCron: config.digestCron ?? undefined,
    };
  }
}
