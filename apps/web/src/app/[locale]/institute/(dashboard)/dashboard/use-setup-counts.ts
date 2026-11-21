import { gql, useQuery } from '@roviq/graphql';
import { useAbility } from '@roviq/ui';

export const STUDENT_COUNT_QUERY = gql`
  query DashboardStudentCount {
    studentStatistics {
      total
    }
  }
`;

export const STAFF_COUNT_QUERY = gql`
  query DashboardStaffCount {
    staffStatistics {
      total
    }
  }
`;

export const STANDARD_IDS_QUERY = gql`
  query DashboardStandardIds {
    standards {
      id
    }
  }
`;

/** How many of each record the institute has; null while loading or when the role cannot read it. */
export interface SetupCounts {
  students: number | null;
  staff: number | null;
  standards: number | null;
}

/** One query per record so a role that cannot read one still gets the others. */
export function useSetupCounts(): SetupCounts {
  const ability = useAbility();
  const students = useQuery<{ studentStatistics: { total: number } }>(STUDENT_COUNT_QUERY, {
    skip: !ability.can('read', 'Student'),
  });
  const staff = useQuery<{ staffStatistics: { total: number } }>(STAFF_COUNT_QUERY, {
    skip: !ability.can('read', 'Staff'),
  });
  const standards = useQuery<{ standards: Array<{ id: string }> }>(STANDARD_IDS_QUERY, {
    skip: !ability.can('read', 'Standard'),
  });
  return {
    students: students.data?.studentStatistics.total ?? null,
    staff: staff.data?.staffStatistics.total ?? null,
    standards: standards.data?.standards.length ?? null,
  };
}
