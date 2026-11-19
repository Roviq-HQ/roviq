'use client';

import { extractGraphQLErrorCode, gql, useMutation, useQuery } from '@roviq/graphql';
import { useTranslations } from 'next-intl';
import {
  ResellerMyProfileDocument,
  type ResellerMyProfileQuery,
  ResellerUpdateBrandingDocument,
  ResellerUpdateProfileDocument,
} from './use-reseller-settings.generated';

export type ResellerProfile = ResellerMyProfileQuery['resellerMyProfile'];

export const RESELLER_PROFILE_FIELDS = gql`
  fragment ResellerProfileFields on ResellerProfileModel {
    id
    name
    slug
    tier
    status
    isSystem
    customDomain
    registrationNumber
    registrationState
    version
    updatedAt
    logo {
      id
      name
      url(variant: MD)
      width
      height
      placeholder
    }
    favicon {
      id
      name
      url(variant: SM)
      width
      height
      placeholder
    }
    branding {
      primaryColor
      secondaryColor
      theme
      customCss
    }
    contact {
      phones {
        countryCode
        number
        isPrimary
        isWhatsappEnabled
        label
      }
      emails {
        address
        isPrimary
        label
      }
    }
    address {
      line1
      line2
      line3
      city
      district
      state
      postalCode
      country
    }
  }
`;

export const RESELLER_MY_PROFILE = gql`
  query ResellerMyProfile {
    resellerMyProfile {
      ...ResellerProfileFields
    }
  }
  ${RESELLER_PROFILE_FIELDS}
`;

export const RESELLER_UPDATE_PROFILE = gql`
  mutation ResellerUpdateProfile($input: ResellerUpdateProfileInput!) {
    resellerUpdateProfile(input: $input) {
      ...ResellerProfileFields
    }
  }
  ${RESELLER_PROFILE_FIELDS}
`;

export const RESELLER_UPDATE_BRANDING = gql`
  mutation ResellerUpdateBranding($input: ResellerUpdateBrandingInput!) {
    resellerUpdateBranding(input: $input) {
      ...ResellerProfileFields
    }
  }
  ${RESELLER_PROFILE_FIELDS}
`;

export function useResellerProfile() {
  return useQuery(ResellerMyProfileDocument, { notifyOnNetworkStatusChange: true });
}

export function useUpdateResellerProfile() {
  return useMutation(ResellerUpdateProfileDocument);
}

export function useUpdateResellerBranding() {
  return useMutation(ResellerUpdateBrandingDocument);
}

/** Maps a settings mutation failure to translated copy via its `extensions.code`. */
export function useSettingsErrorMessage() {
  const t = useTranslations('resellerSettings.errors');
  return (err: unknown): string => {
    const code = extractGraphQLErrorCode(err);
    return code && t.has(code) ? t(code) : t('generic');
  };
}
