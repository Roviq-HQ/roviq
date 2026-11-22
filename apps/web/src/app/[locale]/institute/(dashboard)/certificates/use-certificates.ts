import type { ApolloCache } from '@apollo/client';
import type { TcStatus } from '@roviq/common-types';
import { gql, useLazyQuery, useMutation, useQuery } from '@roviq/graphql';
import type {
  AcademicYearModel,
  CertificateModel,
  ListCertificateFilterInput,
  ListTcFilterInput,
  PreviewCertificateInput,
  RequestCertificateInput,
  RequestDuplicateTcInput,
  RequestTcInput,
  StudentFilterInput,
  StudentModel,
  TcModel,
} from '@roviq/graphql/generated';
import * as React from 'react';

// ─── TC (Transfer Certificate) ──────────────────────────────────────────────

const TC_FIELDS = `
  id
  tcSerialNumber
  status
  reason
  isDuplicate
  isCounterSigned
  originalTcId
  pdf {
    id
  }
  verificationUrl
  academicYearId
  studentProfileId
  studentFirstName
  studentLastName
  standardName
  clearances { department cleared by at notes }
  tcData
  createdAt
`;

const LIST_TCS_QUERY = gql`
  query ListTCs($filter: ListTCFilterInput) {
    listTCs(filter: $filter) {
      ${TC_FIELDS}
    }
  }
`;

const GET_TC_QUERY = gql`
  query GetTCDetails($id: ID!) {
    getTCDetails(id: $id) {
      ${TC_FIELDS}
    }
  }
`;

const REQUEST_TC_MUTATION = gql`
  mutation RequestTC($input: RequestTCInput!) {
    requestTC(input: $input) {
      ${TC_FIELDS}
    }
  }
`;

const REQUEST_DUPLICATE_TC_MUTATION = gql`
  mutation RequestDuplicateTC($input: RequestDuplicateTCInput!) {
    requestDuplicateTC(input: $input) {
      ${TC_FIELDS}
    }
  }
`;

const APPROVE_TC_MUTATION = gql`
  mutation ApproveTC($id: ID!) {
    approveTC(id: $id) {
      ${TC_FIELDS}
    }
  }
`;

const REJECT_TC_MUTATION = gql`
  mutation RejectTC($id: ID!, $reason: String!) {
    rejectTC(id: $id, reason: $reason) {
      ${TC_FIELDS}
    }
  }
`;

const ISSUE_TC_MUTATION = gql`
  mutation IssueTC($id: ID!) {
    issueTC(id: $id) {
      ${TC_FIELDS}
    }
  }
`;

export type TCNode = TcModel;
export type TCListFilter = ListTcFilterInput;

/** Statuses the issuance worker moves on by itself; the screen polls until the TC leaves them. */
const WORKER_ADVANCED_STATUSES: ReadonlySet<TcStatus> = new Set<TcStatus>([
  'REQUESTED',
  'CLEARANCE_PENDING',
  'CLEARANCE_COMPLETE',
]);
export const TC_POLL_INTERVAL_MS = 3000;

export function isAdvancedByWorker(status: TcStatus) {
  return WORKER_ADVANCED_STATUSES.has(status);
}

/** Polls while `active`; Apollo's own `pollInterval` cannot stop once the data says so. */
function usePollWhile(
  active: boolean,
  query: { startPolling: (ms: number) => void; stopPolling: () => void },
) {
  const { startPolling, stopPolling } = query;
  React.useEffect(() => {
    if (!active) return;
    startPolling(TC_POLL_INTERVAL_MS);
    return () => stopPolling();
  }, [active, startPolling, stopPolling]);
}

// Evicting the root field refetches every mounted TC list; naming `ListTCs` in
// `refetchQueries` warns whenever the list is not mounted (the detail page).
function evictTcLists(cache: ApolloCache) {
  cache.evict({ id: 'ROOT_QUERY', fieldName: 'listTCs' });
  cache.gc();
}

export function useTCs(filter?: TCListFilter, options?: { skip?: boolean }) {
  const query = useQuery<{ listTCs: TCNode[] }>(LIST_TCS_QUERY, {
    variables: { filter: filter ?? {} },
    notifyOnNetworkStatusChange: true,
    skip: options?.skip,
  });
  const tcs = query.data?.listTCs ?? [];
  usePollWhile(
    tcs.some((tc) => isAdvancedByWorker(tc.status)),
    query,
  );
  return {
    tcs,
    loading: query.loading,
    refetch: query.refetch,
  };
}

export function useTC(id: string, options?: { skip?: boolean }) {
  const query = useQuery<{ getTCDetails: TCNode }>(GET_TC_QUERY, {
    variables: { id },
    skip: !id || options?.skip,
  });
  const status = query.data?.getTCDetails.status;
  usePollWhile(status !== undefined && isAdvancedByWorker(status), query);
  return query;
}

export type RequestTCInput = RequestTcInput;

export function useRequestTC() {
  return useMutation<{ requestTC: TCNode }, { input: RequestTCInput }>(REQUEST_TC_MUTATION, {
    update: evictTcLists,
  });
}

export type RequestDuplicateTCInput = RequestDuplicateTcInput;

export function useRequestDuplicateTC() {
  return useMutation<{ requestDuplicateTC: TCNode }, { input: RequestDuplicateTCInput }>(
    REQUEST_DUPLICATE_TC_MUTATION,
    { update: evictTcLists },
  );
}

// The mutations below return the whole TC, which updates the cached TC in place.
export function useApproveTC() {
  return useMutation<{ approveTC: TCNode }, { id: string }>(APPROVE_TC_MUTATION, {
    update: evictTcLists,
  });
}

export function useRejectTC() {
  return useMutation<{ rejectTC: TCNode }, { id: string; reason: string }>(REJECT_TC_MUTATION, {
    update: evictTcLists,
  });
}

const GENERATE_TC_PDF_MUTATION = gql`
  mutation GenerateTCPdf($id: ID!) {
    generateTCPdf(id: $id) {
      ${TC_FIELDS}
    }
  }
`;

/** Renders the PDF of an issued TC whose render at issue failed. */
export function useGenerateTCPdf() {
  return useMutation<{ generateTCPdf: TCNode }, { id: string }>(GENERATE_TC_PDF_MUTATION);
}

export function useIssueTC() {
  return useMutation<{ issueTC: TCNode }, { id: string }>(ISSUE_TC_MUTATION, {
    update: evictTcLists,
  });
}

// ─── Certificates ────────────────────────────────────────────────────────────

const CERTIFICATE_FIELDS = `
  id
  serialNumber
  status
  purpose
  templateId
  studentProfileId
  staffProfileId
  certificateData
  pdf {
    id
  }
  createdAt
`;

const LIST_CERTIFICATES_QUERY = gql`
  query ListCertificates($filter: ListCertificateFilterInput) {
    listCertificates(filter: $filter) {
      ${CERTIFICATE_FIELDS}
    }
  }
`;

const GET_CERTIFICATE_QUERY = gql`
  query GetCertificate($id: ID!) {
    getCertificate(id: $id) {
      ${CERTIFICATE_FIELDS}
    }
  }
`;

const REQUEST_CERTIFICATE_MUTATION = gql`
  mutation RequestCertificate($input: RequestCertificateInput!) {
    requestCertificate(input: $input) {
      ${CERTIFICATE_FIELDS}
    }
  }
`;

const ISSUE_CERTIFICATE_MUTATION = gql`
  mutation IssueCertificate($id: ID!) {
    issueCertificate(id: $id) {
      ${CERTIFICATE_FIELDS}
    }
  }
`;

export type CertificateNode = CertificateModel;
export type CertificateListFilter = ListCertificateFilterInput;

export function useCertificates(filter?: CertificateListFilter) {
  const { data, loading, refetch } = useQuery<{ listCertificates: CertificateNode[] }>(
    LIST_CERTIFICATES_QUERY,
    {
      variables: { filter: filter ?? {} },
      notifyOnNetworkStatusChange: true,
    },
  );
  return {
    certificates: data?.listCertificates ?? [],
    loading,
    refetch,
  };
}

export function useCertificate(id: string) {
  return useQuery<{ getCertificate: CertificateNode }>(GET_CERTIFICATE_QUERY, {
    variables: { id },
    skip: !id,
  });
}

export type { PreviewCertificateInput, RequestCertificateInput };

export function useRequestCertificate() {
  return useMutation<{ requestCertificate: CertificateNode }, { input: RequestCertificateInput }>(
    REQUEST_CERTIFICATE_MUTATION,
    { refetchQueries: ['ListCertificates'] },
  );
}

export function useIssueCertificate() {
  return useMutation<{ issueCertificate: CertificateNode }, { id: string }>(
    ISSUE_CERTIFICATE_MUTATION,
    { refetchQueries: ['ListCertificates', 'GetCertificate'] },
  );
}

// ─── Template field auto-populate + preview ─────────────────────────────────

const CERTIFICATE_TEMPLATE_FIELDS_QUERY = gql`
  query GetCertificateTemplateFields($templateId: ID!) {
    getCertificateTemplateFields(templateId: $templateId)
  }
`;

/**
 * Fetches the ordered list of placeholder field names for a certificate
 * template. Drives the auto-populated read-only fields inside the Issue
 * Certificate dialog (ROV-170).
 */
export function useCertificateTemplateFields(templateId: string | null | undefined) {
  return useQuery<{ getCertificateTemplateFields: string[] }>(CERTIFICATE_TEMPLATE_FIELDS_QUERY, {
    variables: { templateId: templateId ?? '' },
    skip: !templateId,
  });
}

const PREVIEW_CERTIFICATE_QUERY = gql`
  query PreviewCertificate($input: PreviewCertificateInput!) {
    previewCertificate(input: $input)
  }
`;

/**
 * Lazy query hook used by the "Preview" button in the Issue Certificate
 * dialog — renders the template with the selected student's data and
 * returns an HTML string that the frontend displays in an iframe.
 */
export function usePreviewCertificate() {
  return useLazyQuery<{ previewCertificate: string }, { input: PreviewCertificateInput }>(
    PREVIEW_CERTIFICATE_QUERY,
  );
}

// ─── Lightweight student picker (shared across dialogs) ─────────────────────

const STUDENTS_PICKER_QUERY = gql`
  query StudentsForCertificatePicker($filter: StudentFilterInput) {
    listStudents(filter: $filter) {
      edges {
        node {
          id
          admissionNumber
          firstName
          lastName
          currentStandardName
          currentSectionName
        }
      }
    }
  }
`;

export type StudentPickerNode = StudentModel;

export function useStudentPicker(
  search: string,
  filter?: Pick<StudentFilterInput, 'academicStatus'>,
) {
  return useQuery<{
    listStudents: { edges: Array<{ node: StudentPickerNode }> };
  }>(STUDENTS_PICKER_QUERY, {
    variables: { filter: { first: 50, search: search || undefined, ...filter } },
  });
}

// ─── Academic years for TC request dialog ────────────────────────────────────

const ACADEMIC_YEARS_QUERY = gql`
  query AcademicYearsForCertificates {
    academicYears {
      id
      label
      isActive
    }
  }
`;

export type AcademicYearPickerNode = AcademicYearModel;

export function useAcademicYearsForCertificates() {
  return useQuery<{ academicYears: AcademicYearPickerNode[] }>(ACADEMIC_YEARS_QUERY);
}
