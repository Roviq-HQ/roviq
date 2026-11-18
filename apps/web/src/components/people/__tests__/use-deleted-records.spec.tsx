import { InMemoryCache } from '@apollo/client';
import { MockedProvider } from '@apollo/client/testing/react';
import { gql } from '@roviq/graphql';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { useDeletePerson } from '../use-deleted-records';

const DELETE_GUARDIAN = gql`
  mutation DeleteGuardian($id: ID!) {
    done: deleteGuardian(id: $id)
  }
`;

const DELETE_STUDENT = gql`
  mutation DeleteStudent($id: ID!) {
    done: deleteStudent(id: $id)
  }
`;

const CACHED_LISTS = gql`
  query CachedLists {
    listGuardians {
      id
    }
    listStudentGuardians(studentProfileId: "s-1") {
      linkId
    }
    listLinkedStudents(guardianProfileId: "g-1") {
      linkId
    }
    listStudents {
      totalCount
    }
  }
`;

function primedCache() {
  const cache = new InMemoryCache();
  cache.writeQuery({
    query: CACHED_LISTS,
    data: {
      listGuardians: [{ id: 'g-1' }],
      listStudentGuardians: [{ linkId: 'l-1' }],
      listLinkedStudents: [{ linkId: 'l-1' }],
      listStudents: { totalCount: 1 },
    },
  });
  return cache;
}

function cachedRootFields(cache: InMemoryCache): string[] {
  const root = cache.extract().ROOT_QUERY ?? {};
  return Object.keys(root)
    .filter((key) => key !== '__typename')
    .map((key) => key.split('(')[0])
    .sort();
}

function wrapperFor(cache: InMemoryCache, mutation: typeof DELETE_GUARDIAN, id: string) {
  const mocks = [
    { request: { query: mutation, variables: { id } }, result: { data: { done: true } } },
  ];
  return ({ children }: { children: ReactNode }) => (
    <MockedProvider mocks={mocks} cache={cache}>
      {children}
    </MockedProvider>
  );
}

describe('useDeletePerson cache eviction', () => {
  it('should drop the student-side lists that show a deleted guardian', async () => {
    const cache = primedCache();
    const { result } = renderHook(() => useDeletePerson('guardian'), {
      wrapper: wrapperFor(cache, DELETE_GUARDIAN, 'g-1'),
    });

    await act(async () => {
      await result.current[0]({ variables: { id: 'g-1' } });
    });

    expect(cachedRootFields(cache)).toEqual(['listLinkedStudents']);
  });

  it('should drop the guardian-side lists that show a deleted student', async () => {
    const cache = primedCache();
    const { result } = renderHook(() => useDeletePerson('student'), {
      wrapper: wrapperFor(cache, DELETE_STUDENT, 's-1'),
    });

    await act(async () => {
      await result.current[0]({ variables: { id: 's-1' } });
    });

    expect(cachedRootFields(cache)).toEqual(['listStudentGuardians']);
  });
});
