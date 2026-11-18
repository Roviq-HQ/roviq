import type { ApolloCache } from '@apollo/client';
import { gql, useMutation, useQuery } from '@roviq/graphql';
import type { DeletedPersonModel } from '@roviq/graphql/generated';

export type PersonKind = 'student' | 'staff' | 'guardian';

export type DeletedPerson = Pick<
  DeletedPersonModel,
  'id' | 'firstName' | 'lastName' | 'identifier' | 'deletedAt'
>;

const DELETED_PERSON_FIELDS = `
  id
  firstName
  lastName
  identifier
  deletedAt
`;

const LIST = {
  student: gql`
    query DeletedStudents {
      deleted: listDeletedStudents { ${DELETED_PERSON_FIELDS} }
    }
  `,
  staff: gql`
    query DeletedStaff {
      deleted: listDeletedStaff { ${DELETED_PERSON_FIELDS} }
    }
  `,
  guardian: gql`
    query DeletedGuardians {
      deleted: listDeletedGuardians { ${DELETED_PERSON_FIELDS} }
    }
  `,
};

const RESTORE = {
  student: gql`
    mutation RestoreStudent($id: ID!) {
      done: restoreStudent(id: $id)
    }
  `,
  staff: gql`
    mutation RestoreStaffMember($id: ID!) {
      done: restoreStaffMember(id: $id)
    }
  `,
  guardian: gql`
    mutation RestoreGuardian($id: ID!) {
      done: restoreGuardian(id: $id)
    }
  `,
};

const DELETE = {
  student: gql`
    mutation DeleteStudent($id: ID!) {
      done: deleteStudent(id: $id)
    }
  `,
  staff: gql`
    mutation DeleteStaffMember($id: ID!) {
      done: deleteStaffMember(id: $id)
    }
  `,
  guardian: gql`
    mutation DeleteGuardian($id: ID!) {
      done: deleteGuardian(id: $id)
    }
  `,
};

// Root fields a delete or restore makes stale. Evicting them refetches every
// mounted query that reads them; naming queries in `refetchQueries` warns when
// the list page is not mounted (delete runs on the detail page).
// Guardian and student lists also show each other (linked children, guardians
// tab, primary guardian column), so a delete makes the other side stale too.
const STALE_FIELDS: Record<PersonKind, string[]> = {
  student: [
    'listStudents',
    'listDeletedStudents',
    'studentStatistics',
    'listLinkedStudents',
    'listGuardians',
  ],
  staff: ['listStaff', 'listDeletedStaff', 'staffStatistics'],
  guardian: ['listGuardians', 'listDeletedGuardians', 'listStudentGuardians', 'listStudents'],
};

function evictStale(kind: PersonKind, cache: ApolloCache) {
  for (const fieldName of STALE_FIELDS[kind]) {
    cache.evict({ id: 'ROOT_QUERY', fieldName });
  }
  cache.gc();
}

export function useDeletedPeople(kind: PersonKind, skip: boolean) {
  return useQuery<{ deleted: DeletedPerson[] }>(LIST[kind], {
    skip,
    fetchPolicy: 'cache-and-network',
  });
}

export function useRestorePerson(kind: PersonKind) {
  return useMutation<{ done: boolean }, { id: string }>(RESTORE[kind], {
    update: (cache) => evictStale(kind, cache),
  });
}

export function useDeletePerson(kind: PersonKind) {
  return useMutation<{ done: boolean }, { id: string }>(DELETE[kind], {
    update: (cache) => evictStale(kind, cache),
  });
}
