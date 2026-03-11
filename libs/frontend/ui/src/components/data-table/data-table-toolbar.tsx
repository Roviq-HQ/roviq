'use client';

import { cn } from '../../lib/utils';

export interface DataTableToolbarProps {
  children: React.ReactNode;
  className?: string;
}

export function DataTableToolbar({ children, className }: DataTableToolbarProps) {
  return <div className={cn('flex flex-wrap items-center gap-2 py-4', className)}>{children}</div>;
}
