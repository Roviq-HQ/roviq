import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataTablePagination } from '../data-table-pagination';

afterEach(cleanup);

describe('DataTablePagination', () => {
  it('shows current count', () => {
    render(
      <DataTablePagination
        hasNextPage={false}
        isLoadingMore={false}
        onLoadMore={() => {}}
        currentCount={10}
      />,
    );
    expect(screen.getByText(/Showing 10/)).toBeDefined();
  });

  it('shows total count when provided', () => {
    render(
      <DataTablePagination
        hasNextPage={false}
        isLoadingMore={false}
        onLoadMore={() => {}}
        currentCount={10}
        totalCount={50}
      />,
    );
    expect(screen.getByText(/of 50/)).toBeDefined();
  });

  it('hides load more button when hasNextPage is false', () => {
    render(
      <DataTablePagination
        hasNextPage={false}
        isLoadingMore={false}
        onLoadMore={() => {}}
        currentCount={10}
      />,
    );
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows load more button when hasNextPage is true', () => {
    render(
      <DataTablePagination
        hasNextPage
        isLoadingMore={false}
        onLoadMore={() => {}}
        currentCount={10}
      />,
    );
    expect(screen.getByRole('button', { name: 'Load more' })).toBeDefined();
  });

  it('calls onLoadMore when button is clicked', () => {
    const onLoadMore = vi.fn();
    render(
      <DataTablePagination
        hasNextPage
        isLoadingMore={false}
        onLoadMore={onLoadMore}
        currentCount={10}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(onLoadMore).toHaveBeenCalledOnce();
  });

  it('disables button when isLoadingMore is true', () => {
    render(
      <DataTablePagination hasNextPage isLoadingMore onLoadMore={() => {}} currentCount={10} />,
    );
    expect(screen.getByRole('button').hasAttribute('disabled')).toBe(true);
  });

  it('supports custom labels', () => {
    render(
      <DataTablePagination
        hasNextPage
        isLoadingMore={false}
        onLoadMore={() => {}}
        currentCount={5}
        totalCount={20}
        labels={{ showing: 'Displaying', of: 'out of', loadMore: 'Fetch more' }}
      />,
    );
    expect(screen.getByText(/Displaying 5/)).toBeDefined();
    expect(screen.getByText(/out of 20/)).toBeDefined();
    expect(screen.getByRole('button', { name: 'Fetch more' })).toBeDefined();
  });
});
