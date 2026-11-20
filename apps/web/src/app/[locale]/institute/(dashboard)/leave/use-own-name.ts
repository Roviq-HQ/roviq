'use client';

import { gql, useQuery } from '@roviq/graphql';
import { useI18nField } from '@roviq/i18n';
import { LeaveApplicantSelfDocument } from './use-own-name.generated';

export const LEAVE_APPLICANT_SELF = gql`
  query LeaveApplicantSelf {
    myProfile {
      __typename
      ... on MyStudentProfile {
        userProfile {
          id
          firstName
          lastName
        }
      }
      ... on MyStaffProfile {
        userProfile {
          id
          firstName
          lastName
        }
      }
      ... on MyGuardianProfile {
        userProfile {
          id
          firstName
          lastName
        }
      }
    }
  }
`;

/** The signed-in person's display name, or null while unknown. */
export function useOwnName(skip: boolean): string | null {
  const resolveI18n = useI18nField();
  const { data } = useQuery(LeaveApplicantSelfDocument, { skip });
  const profile = data?.myProfile.userProfile;
  if (!profile) return null;
  const name = [resolveI18n(profile.firstName), resolveI18n(profile.lastName)]
    .filter(Boolean)
    .join(' ');
  return name.length > 0 ? name : null;
}
