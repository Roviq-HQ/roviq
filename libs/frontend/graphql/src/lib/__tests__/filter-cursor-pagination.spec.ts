import { InMemoryCache } from '@apollo/client/cache';
import { gql } from '@apollo/client/core';
import { describe, expect, it } from 'vitest';
import { filterCursorPagination } from '../client';

const QUERY = gql`
  query Users($filter: AdminListUsersFilterInput) {
    adminListUsers(filter: $filter) {
      totalCount
      edges {
        cursor
      }
    }
  }
`;

interface Page {
  adminListUsers: {
    __typename: 'AdminUserConnection';
    totalCount: number;
    edges: Array<{ __typename: 'AdminUserEdge'; cursor: string }>;
  };
}

function page(cursors: string[], totalCount = 3): Page {
  return {
    adminListUsers: {
      __typename: 'AdminUserConnection',
      totalCount,
      edges: cursors.map((cursor) => ({ __typename: 'AdminUserEdge', cursor })),
    },
  };
}

function makeCache() {
  return new InMemoryCache({
    typePolicies: { Query: { fields: { adminListUsers: filterCursorPagination() } } },
  });
}

function cursorsOf(cache: InMemoryCache, filter: Record<string, unknown>) {
  return cache
    .readQuery<Page>({ query: QUERY, variables: { filter } })
    ?.adminListUsers.edges.map((e) => e.cursor);
}

describe('filterCursorPagination', () => {
  it('should append the next page when the filter carries an after cursor', () => {
    const cache = makeCache();

    cache.writeQuery({ query: QUERY, variables: { filter: { first: 2 } }, data: page(['a', 'b']) });
    cache.writeQuery({
      query: QUERY,
      variables: { filter: { first: 2, after: 'b' } },
      data: page(['c']),
    });

    expect(cursorsOf(cache, { first: 2 })).toEqual(['a', 'b', 'c']);
  });

  it('should replace the list when the first page is fetched again', () => {
    const cache = makeCache();

    cache.writeQuery({ query: QUERY, variables: { filter: { first: 2 } }, data: page(['a', 'b']) });
    cache.writeQuery({ query: QUERY, variables: { filter: { first: 2 } }, data: page(['z']) });

    expect(cursorsOf(cache, { first: 2 })).toEqual(['z']);
  });

  it('should keep differently filtered lists apart', () => {
    const cache = makeCache();

    cache.writeQuery({
      query: QUERY,
      variables: { filter: { first: 2, status: ['ACTIVE'] } },
      data: page(['a']),
    });
    cache.writeQuery({
      query: QUERY,
      variables: { filter: { first: 2, status: ['LOCKED'] } },
      data: page(['x']),
    });

    expect(cursorsOf(cache, { first: 2, status: ['ACTIVE'] })).toEqual(['a']);
    expect(cursorsOf(cache, { first: 2, status: ['LOCKED'] })).toEqual(['x']);
  });
});
