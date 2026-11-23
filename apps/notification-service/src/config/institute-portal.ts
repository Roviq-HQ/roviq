import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NotificationEnv } from './env.validation';

/** Where the institute portal is, by the same rule the gateway prints on a TC's QR code. */
@Injectable()
export class InstitutePortal {
  constructor(private readonly config: ConfigService<NotificationEnv, true>) {}

  signInUrl(): string {
    const base =
      this.config.get('INSTITUTE_PORTAL_URL', { infer: true }) ??
      `http://localhost:${this.config.get('WEB_PORT', { infer: true }) ?? '4200'}`;
    return `${base.replace(/\/+$/, '')}/login`;
  }
}
