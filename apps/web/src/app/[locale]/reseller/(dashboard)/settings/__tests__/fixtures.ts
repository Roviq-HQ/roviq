import { ResellerMyProfileDocument } from '../use-reseller-settings.generated';

export const FULL_ADMIN = [
  { action: 'read' as const, subject: 'Reseller' as const },
  { action: 'update' as const, subject: 'Reseller' as const },
];
export const VIEWER = [{ action: 'read' as const, subject: 'all' as const }];

export function buildProfile(overrides: Record<string, unknown> = {}) {
  return {
    __typename: 'ResellerProfileModel',
    id: 'reseller-1',
    name: 'Acme Partners',
    slug: 'acme-partners',
    tier: 'FULL_MANAGEMENT',
    status: 'ACTIVE',
    isSystem: false,
    customDomain: null,
    registrationNumber: 'U80301RJ2020PTC012345',
    registrationState: 'RAJASTHAN',
    version: 4,
    updatedAt: '2026-11-01T00:00:00.000Z',
    branding: {
      __typename: 'ResellerBrandingModel',
      logoUrl: null,
      faviconUrl: null,
      primaryColor: '#0F766E',
      secondaryColor: null,
      theme: 'DARK',
      customCss: null,
    },
    contact: { __typename: 'InstituteContactObject', phones: [], emails: [] },
    address: null,
    ...overrides,
  };
}

export function profileMock(profile: ReturnType<typeof buildProfile>) {
  return {
    request: { query: ResellerMyProfileDocument },
    result: { data: { resellerMyProfile: profile } },
  };
}
