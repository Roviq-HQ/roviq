'use client';

import { gql, useMutation, useQuery } from '@roviq/graphql';
import {
  ResellerAssignableTeamRolesDocument,
  ResellerChangeTeamMemberRoleDocument,
  ResellerDeactivateTeamMemberDocument,
  ResellerInviteTeamMemberDocument,
  ResellerReactivateTeamMemberDocument,
  ResellerTeamMemberActivityDocument,
  ResellerTeamMemberDocument,
  type ResellerTeamMemberQuery,
  ResellerTeamMembersDocument,
  type ResellerTeamMembersQuery,
} from './use-reseller-team.generated';

export type TeamMember =
  ResellerTeamMembersQuery['resellerListTeamMembers']['edges'][number]['node'];
export type TeamMemberDetail = ResellerTeamMemberQuery['resellerGetTeamMember'];
export type TeamSession = NonNullable<TeamMemberDetail['sessions']>[number];

const PAGE_SIZE = 20;

export const TEAM_MEMBER_FIELDS = gql`
  fragment TeamMemberFields on ResellerTeamMemberModel {
    id
    userId
    email
    username
    roleId
    roleName
    isActive
    joinedAt
    lastActiveAt
    canManage
    profile {
      firstName
      lastName
    }
  }
`;

export const RESELLER_TEAM_MEMBERS = gql`
  query ResellerTeamMembers($filter: ResellerTeamFilterInput) {
    resellerListTeamMembers(filter: $filter) {
      totalCount
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        cursor
        node {
          ...TeamMemberFields
        }
      }
    }
  }
  ${TEAM_MEMBER_FIELDS}
`;

export const RESELLER_TEAM_MEMBER = gql`
  query ResellerTeamMember($membershipId: ID!) {
    resellerGetTeamMember(membershipId: $membershipId) {
      id
      userId
      email
      username
      roleId
      roleName
      isActive
      joinedAt
      lastActiveAt
      canManage
      profile {
        firstName
        lastName
      }
      sessions {
        id
        ipAddress
        userAgent
        createdAt
        lastUsedAt
        expiresAt
      }
    }
  }
`;

export const RESELLER_TEAM_MEMBER_ACTIVITY = gql`
  query ResellerTeamMemberActivity($userId: String!, $first: Int) {
    resellerAuditLogs(filter: { userId: $userId }, first: $first) {
      edges {
        node {
          id
          action
          actionType
          entityType
          createdAt
        }
      }
    }
  }
`;

export const RESELLER_ASSIGNABLE_TEAM_ROLES = gql`
  query ResellerAssignableTeamRoles {
    resellerAssignableTeamRoles {
      id
      name
    }
  }
`;

export const RESELLER_INVITE_TEAM_MEMBER = gql`
  mutation ResellerInviteTeamMember($input: ResellerInviteTeamMemberInput!) {
    resellerInviteTeamMember(input: $input) {
      ...TeamMemberFields
    }
  }
  ${TEAM_MEMBER_FIELDS}
`;

export const RESELLER_CHANGE_TEAM_MEMBER_ROLE = gql`
  mutation ResellerChangeTeamMemberRole($membershipId: ID!, $roleId: ID!) {
    resellerChangeTeamMemberRole(membershipId: $membershipId, roleId: $roleId) {
      ...TeamMemberFields
    }
  }
  ${TEAM_MEMBER_FIELDS}
`;

export const RESELLER_DEACTIVATE_TEAM_MEMBER = gql`
  mutation ResellerDeactivateTeamMember($membershipId: ID!) {
    resellerDeactivateTeamMember(membershipId: $membershipId) {
      ...TeamMemberFields
    }
  }
  ${TEAM_MEMBER_FIELDS}
`;

export const RESELLER_REACTIVATE_TEAM_MEMBER = gql`
  mutation ResellerReactivateTeamMember($membershipId: ID!) {
    resellerReactivateTeamMember(membershipId: $membershipId) {
      ...TeamMemberFields
    }
  }
  ${TEAM_MEMBER_FIELDS}
`;

export interface TeamListFilter {
  search?: string;
  isActive?: boolean;
}

export function useTeamMembers(filter: TeamListFilter) {
  const { data, loading, error, fetchMore } = useQuery(ResellerTeamMembersDocument, {
    variables: { filter: { first: PAGE_SIZE, ...filter } },
    notifyOnNetworkStatusChange: true,
  });
  const connection = data?.resellerListTeamMembers;

  const loadMore = async () => {
    const after = connection?.pageInfo.endCursor;
    if (!after) return;
    await fetchMore({ variables: { filter: { first: PAGE_SIZE, ...filter, after } } });
  };

  return {
    members: connection?.edges.map((edge) => edge.node) ?? [],
    totalCount: connection?.totalCount ?? 0,
    hasNextPage: connection?.pageInfo.hasNextPage ?? false,
    loading,
    error,
    loadMore,
  };
}

export function useTeamMember(membershipId: string | null) {
  return useQuery(ResellerTeamMemberDocument, {
    variables: { membershipId: membershipId ?? '' },
    skip: !membershipId,
    fetchPolicy: 'cache-and-network',
  });
}

export function useTeamMemberActivity(userId: string | undefined, enabled: boolean) {
  return useQuery(ResellerTeamMemberActivityDocument, {
    variables: { userId: userId ?? '', first: 10 },
    skip: !userId || !enabled,
    fetchPolicy: 'cache-and-network',
  });
}

export function useAssignableTeamRoles() {
  const { data, loading } = useQuery(ResellerAssignableTeamRolesDocument);
  return { roles: data?.resellerAssignableTeamRoles ?? [], loading };
}

// A new or changed member can move between the filtered lists, so every list is refetched.
const REFETCH = { refetchQueries: ['ResellerTeamMembers'] };

export function useInviteTeamMember() {
  return useMutation(ResellerInviteTeamMemberDocument, REFETCH);
}

export function useChangeTeamMemberRole() {
  return useMutation(ResellerChangeTeamMemberRoleDocument, REFETCH);
}

export function useDeactivateTeamMember() {
  return useMutation(ResellerDeactivateTeamMemberDocument, REFETCH);
}

export function useReactivateTeamMember() {
  return useMutation(ResellerReactivateTeamMemberDocument, REFETCH);
}
