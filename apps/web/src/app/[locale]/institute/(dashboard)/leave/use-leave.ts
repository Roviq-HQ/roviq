'use client';

import type { ApolloCache } from '@apollo/client';
import { LEAVE_STATUS_VALUES, LEAVE_TYPE_VALUES } from '@roviq/common-types';
import { gql, useMutation, useQuery } from '@roviq/graphql';
import type {
  CreateLeaveInput,
  FileRef,
  LeaveModel,
  LeaveStatus,
  LeaveType,
  UpdateLeaveInput,
} from '@roviq/graphql/generated';

export type { LeaveStatus, LeaveType };
/** An attachment as the leave queries select it. `thumbnailUrl` is the MD size of an image. */
export type LeaveFile = Pick<
  FileRef,
  'id' | 'name' | 'contentType' | 'sizeBytes' | 'url' | 'width' | 'height' | 'placeholder'
> & { thumbnailUrl: string | null };
export type LeaveRecord = Omit<LeaveModel, 'files'> & { files: LeaveFile[] };
export type ApplyLeaveInput = CreateLeaveInput;
export type UpdateLeavePayload = UpdateLeaveInput;
export { LEAVE_STATUS_VALUES, LEAVE_TYPE_VALUES };

export interface LeaveListFilter {
  userId?: string | null;
  status?: LeaveStatus | null;
  type?: LeaveType | null;
  startDate?: string | null;
  endDate?: string | null;
}

// ─── Fragments / queries ──────────────────────────────────────────────
//
// The codegen pipeline has not yet emitted typed documents for leaves,
// so we use raw `gql` with hand-written return shapes. Once Tilt
// regenerates the schema the ambient types can replace these — the
// field selection matches `LeaveModel` 1:1 so the migration is
// mechanical.

const LEAVE_FIELDS = `
  id
  userId
  startDate
  endDate
  type
  reason
  status
  files {
    id
    name
    contentType
    sizeBytes
    url
    thumbnailUrl: url(variant: MD)
    width
    height
    placeholder
  }
  decidedBy
  createdAt
  updatedAt
`;

const LEAVES_QUERY = gql`
  query Leaves(
    $userId: ID
    $status: LeaveStatus
    $type: LeaveType
    $startDate: DateOnly
    $endDate: DateOnly
  ) {
    leaves(
      userId: $userId
      status: $status
      type: $type
      startDate: $startDate
      endDate: $endDate
    ) {
      ${LEAVE_FIELDS}
    }
  }
`;

const LEAVE_QUERY = gql`
  query Leave($id: ID!) {
    leave(id: $id) {
      ${LEAVE_FIELDS}
    }
  }
`;

const APPLY_LEAVE = gql`
  mutation ApplyLeave($input: CreateLeaveInput!) {
    applyLeave(input: $input) {
      ${LEAVE_FIELDS}
    }
  }
`;

const UPDATE_LEAVE = gql`
  mutation UpdateLeave($id: ID!, $input: UpdateLeaveInput!) {
    updateLeave(id: $id, input: $input) {
      ${LEAVE_FIELDS}
    }
  }
`;

const APPROVE_LEAVE = gql`
  mutation ApproveLeave($id: ID!) {
    approveLeave(id: $id) {
      ${LEAVE_FIELDS}
    }
  }
`;

const REJECT_LEAVE = gql`
  mutation RejectLeave($id: ID!) {
    rejectLeave(id: $id) {
      ${LEAVE_FIELDS}
    }
  }
`;

const CANCEL_LEAVE = gql`
  mutation CancelLeave($id: ID!) {
    cancelLeave(id: $id) {
      ${LEAVE_FIELDS}
    }
  }
`;

const DELETE_LEAVE = gql`
  mutation DeleteLeave($id: ID!) {
    deleteLeave(id: $id)
  }
`;

// ─── Query hooks ──────────────────────────────────────────────────────

export function useLeaves(filter: LeaveListFilter = {}) {
  const { data, loading, error, refetch } = useQuery<{ leaves: LeaveRecord[] }>(LEAVES_QUERY, {
    variables: {
      userId: filter.userId ?? null,
      status: filter.status ?? null,
      type: filter.type ?? null,
      startDate: filter.startDate ?? null,
      endDate: filter.endDate ?? null,
    },
    fetchPolicy: 'cache-and-network',
  });
  return {
    leaves: data?.leaves ?? [],
    loading,
    error,
    refetch,
  };
}

export function useLeave(id: string | null) {
  const { data, loading, error, refetch } = useQuery<{ leave: LeaveRecord }>(LEAVE_QUERY, {
    variables: { id },
    skip: !id,
    fetchPolicy: 'cache-and-network',
  });
  return {
    leave: data?.leave ?? null,
    loading,
    error,
    refetch,
  };
}

// ─── Mutation hooks ───────────────────────────────────────────────────

// Evict, not `refetchQueries: ['Leaves']`: that warns when the list is unmounted (apply and
// detail pages). Lists refetch the evicted field when they next render.
function evictLeaveLists(cache: ApolloCache) {
  cache.evict({ id: 'ROOT_QUERY', fieldName: 'leaves' });
  cache.gc();
}

export function useApplyLeave() {
  const [mutate, { loading }] = useMutation<
    { applyLeave: LeaveRecord },
    { input: ApplyLeaveInput }
  >(APPLY_LEAVE, { update: evictLeaveLists });
  return {
    apply: (input: ApplyLeaveInput) => mutate({ variables: { input } }),
    loading,
  };
}

export function useUpdateLeave() {
  const [mutate, { loading }] = useMutation<
    { updateLeave: LeaveRecord },
    { id: string; input: UpdateLeavePayload }
  >(UPDATE_LEAVE, { update: evictLeaveLists });
  return {
    update: (id: string, input: UpdateLeavePayload) => mutate({ variables: { id, input } }),
    loading,
  };
}

export function useApproveLeave() {
  const [mutate, { loading }] = useMutation<{ approveLeave: LeaveRecord }, { id: string }>(
    APPROVE_LEAVE,
    { update: evictLeaveLists },
  );
  return {
    approve: (id: string) => mutate({ variables: { id } }),
    loading,
  };
}

export function useRejectLeave() {
  const [mutate, { loading }] = useMutation<{ rejectLeave: LeaveRecord }, { id: string }>(
    REJECT_LEAVE,
    { update: evictLeaveLists },
  );
  return {
    reject: (id: string) => mutate({ variables: { id } }),
    loading,
  };
}

export function useCancelLeave() {
  const [mutate, { loading }] = useMutation<{ cancelLeave: LeaveRecord }, { id: string }>(
    CANCEL_LEAVE,
    { update: evictLeaveLists },
  );
  return {
    cancel: (id: string) => mutate({ variables: { id } }),
    loading,
  };
}

export function useDeleteLeave() {
  const [mutate, { loading }] = useMutation<{ deleteLeave: boolean }, { id: string }>(
    DELETE_LEAVE,
    { update: evictLeaveLists },
  );
  return {
    remove: (id: string) => mutate({ variables: { id } }),
    loading,
  };
}
