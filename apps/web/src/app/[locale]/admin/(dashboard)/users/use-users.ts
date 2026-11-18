import { gql, useQuery } from '@roviq/graphql';
import type { AdminListUsersFilterInput } from '@roviq/graphql/generated';
import {
  AdminGetUserDocument,
  AdminListUsersDocument,
  AdminSearchUsersDocument,
  AdminUserStatisticsDocument,
} from './use-users.generated';

export const PAGE_SIZE = 20;

export const ADMIN_LIST_USERS = gql`
  query AdminListUsers($filter: AdminListUsersFilterInput) {
    adminListUsers(filter: $filter) {
      totalCount
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        cursor
        node {
          id
          username
          email
          status
          createdAt
          lastActiveAt
          primaryPhone {
            countryCode
            number
          }
          profile {
            firstName
            lastName
            profileImageUrl
          }
          memberships {
            id
          }
        }
      }
    }
  }
`;

export const ADMIN_SEARCH_USERS = gql`
  query AdminSearchUsers($query: String!, $limit: Int!) {
    adminSearchUsers(query: $query, limit: $limit) {
      id
      username
      email
      profile {
        firstName
        lastName
      }
    }
  }
`;

export const ADMIN_USER_STATISTICS = gql`
  query AdminUserStatistics {
    adminUserStatistics {
      totalUsers
      activeThisMonth
      newThisWeek
      multiInstituteUsers
    }
  }
`;

export const ADMIN_GET_USER = gql`
  query AdminGetUser($userId: ID!) {
    adminGetUser(userId: $userId) {
      id
      username
      email
      status
      createdAt
      lastActiveAt
      primaryPhone {
        countryCode
        number
      }
      profile {
        firstName
        lastName
        profileImageUrl
        gender
        dateOfBirth
        nationality
      }
      memberships {
        id
        tenantId
        roleName
        status
        instituteName
        joinedAt
      }
      resellerMemberships {
        id
        resellerId
        resellerName
        roleName
        isActive
        joinedAt
      }
      platformMembership {
        id
        roleName
        isActive
        joinedAt
      }
      identifiers {
        id
        type
        displayValue
        isVerified
        issuingAuthority
      }
      documents {
        id
        type
        description
        fileUrls
        referenceNumber
        isVerified
        rejectionReason
        uploadedAt
      }
      addresses {
        id
        type
        line1
        line2
        line3
        city
        district
        state
        country
        postalCode
      }
    }
  }
`;

export function useUsers(filter: AdminListUsersFilterInput) {
  const variables = { filter: { ...filter, first: PAGE_SIZE } };
  const { data, loading, error, fetchMore, refetch } = useQuery(AdminListUsersDocument, {
    variables,
    notifyOnNetworkStatusChange: true,
  });

  const loadMore = () => {
    const after = data?.adminListUsers.pageInfo.endCursor;
    if (!after) return;
    return fetchMore({ variables: { filter: { ...variables.filter, after } } });
  };

  return {
    users: data?.adminListUsers.edges.map((e) => e.node) ?? [],
    totalCount: data?.adminListUsers.totalCount ?? 0,
    hasNextPage: data?.adminListUsers.pageInfo.hasNextPage ?? false,
    loading,
    error,
    loadMore,
    refetch,
  };
}

export function useUserSearch(query: string) {
  return useQuery(AdminSearchUsersDocument, {
    variables: { query, limit: 5 },
    skip: query.trim().length < 2,
  });
}

export function useUserStatistics() {
  return useQuery(AdminUserStatisticsDocument, { fetchPolicy: 'cache-and-network' });
}

export function useAdminUser(userId: string) {
  return useQuery(AdminGetUserDocument, { variables: { userId }, skip: !userId });
}
