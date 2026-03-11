'use client';

import { Button } from '../ui/button';

export interface DataTablePaginationProps {
  hasNextPage: boolean;
  isLoadingMore: boolean;
  onLoadMore: () => void;
  totalCount?: number;
  currentCount: number;
  labels?: {
    loadMore?: string;
    showing?: string;
    of?: string;
  };
}

export function DataTablePagination({
  hasNextPage,
  isLoadingMore,
  onLoadMore,
  totalCount,
  currentCount,
  labels,
}: DataTablePaginationProps) {
  return (
    <div className="flex items-center justify-between px-2 py-4">
      <div className="text-sm text-muted-foreground">
        {labels?.showing ?? 'Showing'} {currentCount}
        {totalCount != null && (
          <>
            {' '}
            {labels?.of ?? 'of'} {totalCount}
          </>
        )}
      </div>
      {hasNextPage && (
        <Button variant="outline" size="sm" onClick={onLoadMore} disabled={isLoadingMore}>
          {isLoadingMore ? (
            <div className="flex items-center gap-2">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              {labels?.loadMore ?? 'Load more'}
            </div>
          ) : (
            (labels?.loadMore ?? 'Load more')
          )}
        </Button>
      )}
    </div>
  );
}
