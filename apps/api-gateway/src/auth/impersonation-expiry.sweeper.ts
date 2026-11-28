import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ImpersonationService } from './impersonation.service';

const SWEEP_INTERVAL_MS = 60 * 1000;

/** Nothing else runs when a session passes `expires_at`, so its end would go unrecorded. */
@Injectable()
export class ImpersonationExpirySweeper implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ImpersonationExpirySweeper.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly impersonationService: ImpersonationService) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.sweep(), SWEEP_INTERVAL_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async sweep(): Promise<void> {
    try {
      await this.impersonationService.expireOverdueSessions();
    } catch (err) {
      this.logger.error({ err }, 'Impersonation expiry sweep failed');
    }
  }
}
