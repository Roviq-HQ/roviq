import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useAppForm } from '../use-app-form';

// Stands in for Radix: one button reports the empty value Radix emits on React 19 when the
// value is set from outside, the other reports a real pick.
vi.mock('@roviq/ui/components/ui/select', () => ({
  Select: ({
    value,
    onValueChange,
  }: {
    value: string;
    onValueChange: (next: string) => void;
    children: ReactNode;
  }) => (
    <div>
      <output data-testid="select-value">{value}</output>
      <button type="button" onClick={() => onValueChange('')}>
        report empty
      </button>
      <button type="button" onClick={() => onValueChange('modern')}>
        pick modern
      </button>
    </div>
  ),
  SelectContent: () => null,
  SelectItem: () => null,
  SelectTrigger: () => null,
  SelectValue: () => null,
}));

const options = [
  { value: 'classic', label: 'Classic' },
  { value: 'modern', label: 'Modern' },
];

function ThemeForm({ onValueChange }: { onValueChange: (value: string | undefined) => void }) {
  const form = useAppForm({ defaultValues: { theme: 'classic' } });
  return (
    <form>
      <form.AppField name="theme">
        {(field) => (
          <field.SelectField label="Theme" options={options} onValueChange={onValueChange} />
        )}
      </form.AppField>
      <form.Subscribe selector={(state) => state.isDirty}>
        {(isDirty) => <output data-testid="dirty">{String(isDirty)}</output>}
      </form.Subscribe>
    </form>
  );
}

describe('SelectField', () => {
  it('should keep the value and leave the form untouched when the select reports an empty value', async () => {
    const onValueChange = vi.fn();
    render(<ThemeForm onValueChange={onValueChange} />);

    await userEvent.click(screen.getByRole('button', { name: 'report empty' }));

    expect(screen.getByTestId('select-value')).toHaveTextContent('classic');
    expect(screen.getByTestId('dirty')).toHaveTextContent('false');
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('should store a picked option and tell the caller', async () => {
    const onValueChange = vi.fn();
    render(<ThemeForm onValueChange={onValueChange} />);

    await userEvent.click(screen.getByRole('button', { name: 'pick modern' }));

    expect(screen.getByTestId('select-value')).toHaveTextContent('modern');
    expect(screen.getByTestId('dirty')).toHaveTextContent('true');
    expect(onValueChange).toHaveBeenCalledWith('modern');
  });
});
