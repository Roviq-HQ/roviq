import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MultiSelect, type MultiSelectProps } from '../multi-select';

const options = [
  { value: 'CREATE', label: 'Create' },
  { value: 'DELETE', label: 'Delete' },
  { value: 'SUSPEND', label: 'Suspend' },
];

function renderSelect(overrides: Partial<MultiSelectProps> = {}) {
  const onChange = vi.fn();
  render(
    <MultiSelect
      options={options}
      value={[]}
      onChange={onChange}
      placeholder="Action type"
      selectedLabel={(count) => `${count} types selected`}
      clearLabel="Clear selection"
      {...overrides}
    />,
  );
  return onChange;
}

describe('MultiSelect', () => {
  it('shows the placeholder when nothing is selected', () => {
    renderSelect();

    expect(screen.getByRole('button', { name: 'Action type' })).toHaveTextContent('Action type');
  });

  it('shows the option label for a single selection', () => {
    renderSelect({ value: ['DELETE'] });
    expect(screen.getByRole('button', { name: 'Action type' })).toHaveTextContent('Delete');
  });

  it('shows a count when several options are selected', () => {
    renderSelect({ value: ['DELETE', 'SUSPEND'] });

    expect(screen.getByRole('button', { name: 'Action type' })).toHaveTextContent(
      '2 types selected',
    );
  });

  it('adds an option to the selection in option order', async () => {
    const user = userEvent.setup();
    const onChange = renderSelect({ value: ['SUSPEND'] });

    await user.click(screen.getByRole('button', { name: 'Action type' }));
    await user.click(await screen.findByRole('checkbox', { name: 'Delete' }));

    expect(onChange).toHaveBeenCalledWith(['DELETE', 'SUSPEND']);
  });

  it('removes an already selected option', async () => {
    const user = userEvent.setup();
    const onChange = renderSelect({ value: ['DELETE', 'SUSPEND'] });

    await user.click(screen.getByRole('button', { name: 'Action type' }));
    await user.click(await screen.findByRole('checkbox', { name: 'Delete' }));

    expect(onChange).toHaveBeenCalledWith(['SUSPEND']);
  });

  it('clears the whole selection', async () => {
    const user = userEvent.setup();
    const onChange = renderSelect({ value: ['DELETE', 'SUSPEND'] });

    await user.click(screen.getByRole('button', { name: 'Action type' }));
    await user.click(await screen.findByRole('button', { name: 'Clear selection' }));

    expect(onChange).toHaveBeenCalledWith([]);
  });
});
