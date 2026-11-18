import '@testing-library/jest-dom/vitest';
import type { ColumnDef } from '@tanstack/react-table';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DataTable, type DataTableExpansion } from '../data-table';

interface TestRow {
  id: string;
  name: string;
  note: string | null;
}

const columns: ColumnDef<TestRow, unknown>[] = [{ accessorKey: 'name', header: 'Name' }];

const alice: TestRow = { id: 'a', name: 'Alice', note: 'Note for Alice' };
const bob: TestRow = { id: 'b', name: 'Bob', note: null };

const expansion: DataTableExpansion<TestRow> = {
  render: (row) => <p>{row.note}</p>,
  canExpand: (row) => row.note !== null,
  labels: { expand: 'Show details', collapse: 'Hide details' },
};

describe('DataTable row expansion', () => {
  it('renders no toggle when expansion is not configured', () => {
    render(<DataTable columns={columns} data={[alice]} />);

    expect(screen.queryByRole('button', { name: 'Show details' })).not.toBeInTheDocument();
  });

  it('shows the expanded content on toggle and hides it again', async () => {
    const user = userEvent.setup();
    render(
      <DataTable
        columns={columns}
        data={[alice, bob]}
        expansion={expansion}
        getRowId={(r) => r.id}
      />,
    );

    expect(screen.queryByText('Note for Alice')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Show details' }));
    expect(screen.getByText('Note for Alice')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hide details' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );

    await user.click(screen.getByRole('button', { name: 'Hide details' }));
    expect(screen.queryByText('Note for Alice')).not.toBeInTheDocument();
  });

  it('offers a toggle only for rows that can expand', () => {
    render(
      <DataTable
        columns={columns}
        data={[alice, bob]}
        expansion={expansion}
        getRowId={(r) => r.id}
      />,
    );

    expect(screen.getAllByRole('button', { name: 'Show details' })).toHaveLength(1);
  });

  it('does not trigger onRowClick when the toggle is clicked', async () => {
    const user = userEvent.setup();
    const onRowClick = vi.fn();
    render(
      <DataTable
        columns={columns}
        data={[alice]}
        expansion={expansion}
        getRowId={(r) => r.id}
        onRowClick={onRowClick}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Show details' }));

    expect(onRowClick).not.toHaveBeenCalled();
  });

  it('keeps a row expanded by identity when rows are prepended', async () => {
    const user = userEvent.setup();
    const carol: TestRow = { id: 'c', name: 'Carol', note: 'Note for Carol' };
    const props = { columns, expansion, getRowId: (r: TestRow) => r.id };
    const { rerender } = render(<DataTable {...props} data={[alice]} />);

    await user.click(screen.getByRole('button', { name: 'Show details' }));
    rerender(<DataTable {...props} data={[carol, alice]} />);

    expect(screen.getByText('Note for Alice')).toBeInTheDocument();
    expect(screen.queryByText('Note for Carol')).not.toBeInTheDocument();
  });
});
