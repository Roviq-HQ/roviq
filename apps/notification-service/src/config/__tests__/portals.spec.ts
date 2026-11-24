import { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';
import { Portals } from '../portals';

describe('Portals', () => {
  it('should name each portal by its own setting, without a trailing slash', () => {
    const portals = new Portals(
      new ConfigService({
        INSTITUTE_PORTAL_URL: 'https://app.roviq.com/',
        RESELLER_PORTAL_URL: 'https://reseller.roviq.com',
        ADMIN_PORTAL_URL: 'https://admin.roviq.com//',
      }),
    );

    expect(portals.signInUrl('institute')).toBe('https://app.roviq.com/login');
    expect(portals.signInUrl('reseller')).toBe('https://reseller.roviq.com/login');
    expect(portals.signInUrl('platform')).toBe('https://admin.roviq.com/login');
  });

  it('should fall back to the development hosts on WEB_PORT', () => {
    const portals = new Portals(new ConfigService({ WEB_PORT: '4220' }));

    expect(portals.signInUrl('institute')).toBe('http://localhost:4220/login');
    expect(portals.signInUrl('reseller')).toBe('http://reseller.localhost:4220/login');
    expect(portals.signInUrl('platform')).toBe('http://admin.localhost:4220/login');
  });
});
