'use client';

import {
  type ColumnDef,
  type ExpandedState,
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
  type Row,
  useReactTable,
} from '@tanstack/react-table';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../ui/button';
import { Skeleton } from '../ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';

export interface DataTableExpansion<TData> {
  /** Content shown in a full-width row under an expanded row. */
  render: (row: TData) => React.ReactNode;
  /** Rows returning false get no toggle. Defaults to every row. */
  canExpand?: (row: TData) => boolean;
  /** Translated names for the toggle button. */
  labels: { expand: string; collapse: string };
}

export interface DataTableProps<TData> {
  columns: ColumnDef<TData, unknown>[];
  data: TData[];
  isLoading?: boolean;
  /** @deprecated Use `emptyState` instead for contextual empty states */
  emptyMessage?: string;
  emptyState?: React.ReactNode;
  onRowClick?: (row: TData) => void;
  'data-testid'?: string;
  /**
   * When true, the first column is `sticky left-0` with a subtle inset
   * shadow on its right edge. Used for selection/checkbox columns that
   * must stay visible while the rest of the table scrolls horizontally.
   * Implements rule [IXABI] from frontend-ux. Defaults to false.
   */
  stickyFirstColumn?: boolean;
  /**
   * When true, the LAST column is `sticky right-0` with an inset shadow
   * on its left edge. Used for action/menu columns. Defaults to false.
   */
  stickyLastColumn?: boolean;
  /**
   * Number of skeleton rows to render while `isLoading=true` and `data`
   * is empty. Replaces the single-spinner loading state with rows that
   * match the actual table layout, per rule [IMUXO]. Each cell renders
   * a `<Skeleton>` from this same library. Set to 0 (default) to keep
   * the existing spinner-row behaviour.
   */
  skeletonRows?: number;
  /** Adds a leading toggle column; an expanded row shows `expansion.render(row)` beneath it. */
  expansion?: DataTableExpansion<TData>;
  /**
   * Stable row identity. Pass it with `expansion` whenever rows can change
   * (filters, pagination) — the default index id would keep the wrong row open.
   */
  getRowId?: (row: TData) => string;
}

const STICKY_FIRST_CLASS =
  'sticky left-0 z-10 bg-background shadow-[inset_-1px_0_0_0_hsl(var(--border))]';
const STICKY_LAST_CLASS =
  'sticky right-0 z-10 bg-background shadow-[inset_1px_0_0_0_hsl(var(--border))]';

function stickyClassFor(
  index: number,
  lastIndex: number,
  stickyFirst: boolean,
  stickyLast: boolean,
): string | undefined {
  if (stickyFirst && index === 0) return STICKY_FIRST_CLASS;
  if (stickyLast && index === lastIndex) return STICKY_LAST_CLASS;
  return undefined;
}

export function DataTable<TData>({
  columns,
  data,
  isLoading,
  emptyMessage,
  emptyState,
  onRowClick,
  stickyFirstColumn = false,
  stickyLastColumn = false,
  skeletonRows = 0,
  expansion,
  getRowId,
  'data-testid': dataTestId,
}: DataTableProps<TData>) {
  const [expanded, setExpanded] = useState<ExpandedState>({});
  const table = useReactTable({
    data,
    columns,
    state: { expanded },
    onExpandedChange: setExpanded,
    getRowId,
    getRowCanExpand: (row) =>
      expansion !== undefined && (expansion.canExpand?.(row.original) ?? true),
    getCoreRowModel: getCoreRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
  });

  const lastColumnIndex = columns.length - 1;
  const totalColumns = columns.length + (expansion ? 1 : 0);
  const showSkeletonRows = isLoading && skeletonRows > 0 && data.length === 0;

  return (
    <div className="rounded-md border overflow-x-auto" data-testid={dataTestId}>
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {expansion && <TableHead className="w-10" />}
              {headerGroup.headers.map((header, headerIndex) => (
                <TableHead
                  key={header.id}
                  data-testid={dataTestId ? `${dataTestId}-col-${header.id}` : undefined}
                  className={stickyClassFor(
                    headerIndex,
                    lastColumnIndex,
                    stickyFirstColumn,
                    stickyLastColumn,
                  )}
                >
                  {header.isPlaceholder
                    ? null
                    : flexRender(header.column.columnDef.header, header.getContext())}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {isLoading && !showSkeletonRows ? (
            <TableRow>
              <TableCell colSpan={totalColumns} className="h-24 text-center">
                <div className="flex items-center justify-center">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                </div>
              </TableCell>
            </TableRow>
          ) : showSkeletonRows ? (
            Array.from({ length: skeletonRows }).map((_, rowIndex) => (
              <TableRow key={`skeleton-row-${rowIndex}`}>
                {expansion && <TableCell className="w-10" />}
                {columns.map((_col, cellIndex) => (
                  <TableCell
                    key={`skeleton-cell-${rowIndex}-${cellIndex}`}
                    className={stickyClassFor(
                      cellIndex,
                      lastColumnIndex,
                      stickyFirstColumn,
                      stickyLastColumn,
                    )}
                  >
                    <Skeleton className="h-4 w-3/4" />
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : table.getRowModel().rows.length > 0 ? (
            table
              .getRowModel()
              .rows.map((row) => (
                <DataRow
                  key={row.id}
                  row={row}
                  expansion={expansion}
                  onRowClick={onRowClick}
                  totalColumns={totalColumns}
                  testId={dataTestId}
                  cellClassName={(cellIndex) =>
                    stickyClassFor(cellIndex, lastColumnIndex, stickyFirstColumn, stickyLastColumn)
                  }
                />
              ))
          ) : emptyState ? (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={totalColumns} className="p-0">
                {emptyState}
              </TableCell>
            </TableRow>
          ) : (
            <TableRow>
              <TableCell colSpan={totalColumns} className="h-24 text-center">
                {emptyMessage ?? 'No results.'}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

function DataRow<TData>({
  row,
  expansion,
  onRowClick,
  totalColumns,
  testId,
  cellClassName,
}: {
  row: Row<TData>;
  expansion: DataTableExpansion<TData> | undefined;
  onRowClick: ((row: TData) => void) | undefined;
  totalColumns: number;
  testId: string | undefined;
  cellClassName: (cellIndex: number) => string | undefined;
}) {
  const isExpanded = row.getIsExpanded();

  return (
    <>
      <TableRow
        data-state={row.getIsSelected() ? 'selected' : undefined}
        className={onRowClick ? 'cursor-pointer' : undefined}
        onClick={onRowClick ? () => onRowClick(row.original) : undefined}
      >
        {expansion && (
          <TableCell className="w-10 pe-0">
            {row.getCanExpand() && (
              <ExpandToggle
                isExpanded={isExpanded}
                label={isExpanded ? expansion.labels.collapse : expansion.labels.expand}
                testId={testId ? `${testId}-expand-${row.id}` : undefined}
                onToggle={() => row.toggleExpanded()}
              />
            )}
          </TableCell>
        )}
        {row.getVisibleCells().map((cell, cellIndex) => (
          <TableCell key={cell.id} className={cellClassName(cellIndex)}>
            {flexRender(cell.column.columnDef.cell, cell.getContext())}
          </TableCell>
        ))}
      </TableRow>
      {expansion && isExpanded && (
        <TableRow
          className="hover:bg-transparent"
          data-testid={testId ? `${testId}-expanded-${row.id}` : undefined}
        >
          <TableCell colSpan={totalColumns} className="bg-muted/30 p-4">
            {expansion.render(row.original)}
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

function ExpandToggle({
  isExpanded,
  label,
  testId,
  onToggle,
}: {
  isExpanded: boolean;
  label: string;
  testId: string | undefined;
  onToggle: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="size-7"
      aria-expanded={isExpanded}
      aria-label={label}
      title={label}
      data-testid={testId}
      onClick={(event) => {
        // The row itself may be clickable; the toggle must not trigger it.
        event.stopPropagation();
        onToggle();
      }}
    >
      {isExpanded ? (
        <ChevronDown className="size-4" />
      ) : (
        <ChevronRight className="size-4 rtl:rotate-180" />
      )}
    </Button>
  );
}
