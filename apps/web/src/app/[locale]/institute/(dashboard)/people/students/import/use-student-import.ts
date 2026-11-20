import { gql, useMutation, useQuery } from '@roviq/graphql';
import type { BulkImportStatus } from '@roviq/graphql/generated';
import * as React from 'react';
import type {
  StartStudentImportMutation,
  StartStudentImportMutationVariables,
  StudentImportProgressQuery,
  StudentImportProgressQueryVariables,
} from './use-student-import.generated';

const START_STUDENT_IMPORT = gql`
  mutation StartStudentImport($input: BulkCreateStudentsInput!) {
    bulkCreateStudents(input: $input) {
      workflowId
    }
  }
`;

const STUDENT_IMPORT_PROGRESS = gql`
  query StudentImportProgress($workflowId: String!) {
    bulkImportProgress(workflowId: $workflowId) {
      status
      totalRows
      processed
      created
      skipped
      errors
      report {
        id
        name
        url
      }
    }
  }
`;

const POLL_MS = 1500;
const FINISHED: readonly BulkImportStatus[] = ['COMPLETED', 'FAILED'];

export function useStartStudentImport() {
  return useMutation<StartStudentImportMutation, StartStudentImportMutationVariables>(
    START_STUDENT_IMPORT,
  );
}

/** Polls an import until it has completed or failed. */
export function useStudentImportProgress(workflowId: string | null) {
  const result = useQuery<StudentImportProgressQuery, StudentImportProgressQueryVariables>(
    STUDENT_IMPORT_PROGRESS,
    {
      variables: { workflowId: workflowId ?? '' },
      skip: !workflowId,
      fetchPolicy: 'network-only',
      notifyOnNetworkStatusChange: false,
    },
  );
  const status = result.data?.bulkImportProgress.status;
  const finished = status !== undefined && FINISHED.includes(status);
  const { startPolling, stopPolling } = result;

  React.useEffect(() => {
    if (!workflowId || finished) {
      stopPolling();
      return;
    }
    startPolling(POLL_MS);
    return stopPolling;
  }, [workflowId, finished, startPolling, stopPolling]);

  return { ...result, finished };
}
