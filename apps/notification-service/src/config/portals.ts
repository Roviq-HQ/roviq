import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NotificationEnv } from './env.validation';

export type PortalScope = 'institute' | 'reseller' | 'platform';

/** The setting that names each portal's public address, and its development host. */
const PORTALS: Record<PortalScope, { setting: keyof NotificationEnv; devHost: string }> = {
  institute: { setting: 'INSTITUTE_PORTAL_URL', devHost: 'localhost' },
  reseller: { setting: 'RESELLER_PORTAL_URL', devHost: 'reseller.localhost' },
  platform: { setting: 'ADMIN_PORTAL_URL', devHost: 'admin.localhost' },
};

/**
 * Where each portal signs people in. The web app picks the portal from the host name, so each
 * portal has its own address.
 */
@Injectable()
export class Portals {
  constructor(private readonly config: ConfigService<NotificationEnv, true>) {}

  signInUrl(scope: PortalScope): string {
    const { setting, devHost } = PORTALS[scope];
    const configured = this.config.get(setting, { infer: true });
    const base =
      typeof configured === 'string' && configured.length > 0
        ? configured
        : `http://${devHost}:${this.config.get('WEB_PORT', { infer: true }) ?? '4200'}`;
    return `${base.replace(/\/+$/, '')}/login`;
  }
}
