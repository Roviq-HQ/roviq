'use client';

import { Field, FieldDescription, FieldError } from '@roviq/ui/components/ui/field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@roviq/ui/components/ui/select';
import { fieldErrorMessages } from '@roviq/ui/form/errors';
import { FieldLabelWithInfo } from '@roviq/ui/form/fields/field-label-with-info';
import { useFieldContext } from '@roviq/ui/form/use-app-form';
import type { ReactNode } from 'react';

export interface SelectOption<TValue extends string = string> {
  value: TValue;
  label: ReactNode;
  disabled?: boolean;
}

export interface SelectFieldProps<TValue extends string = string> {
  label: ReactNode;
  options: ReadonlyArray<SelectOption<TValue>>;
  description?: ReactNode;
  /**
   * Optional slot rendered inline after the label text — typically a
   * `<FieldInfoPopover>` but accepts any `ReactNode` so callers can swap in
   * a custom popover, hover-card, or drawer trigger without an API change.
   */
  info?: ReactNode;
  placeholder?: string;
  testId?: string;
  disabled?: boolean;
  /** `false` marks the field required: a marker after the label and `aria-required`. */
  optional?: boolean;
  /** Called after the field's `handleChange` so callers can reset dependents. */
  onValueChange?: (value: TValue | undefined) => void;
}

/**
 * Single-select bound to a string-or-undefined field. An unset field shows the placeholder.
 *
 * For cascading dropdowns, pass `onValueChange` to clear dependent fields:
 * ```tsx
 * <field.SelectField onValueChange={() => form.setFieldValue('standardId', '')} />
 * ```
 */
export function SelectField<TValue extends string = string>({
  label,
  options,
  description,
  info,
  placeholder,
  testId,
  disabled,
  optional,
  onValueChange,
}: SelectFieldProps<TValue>) {
  const required = optional === false;
  const field = useFieldContext<TValue | undefined>();
  const errors = fieldErrorMessages(field);
  const invalid = errors.length > 0;
  const value = typeof field.state.value === 'string' ? field.state.value : '';
  return (
    <Field data-invalid={invalid || undefined}>
      <FieldLabelWithInfo htmlFor={field.name} info={info} required={required}>
        {label}
      </FieldLabelWithInfo>
      <Select
        value={value}
        onValueChange={(next) => {
          // Radix on React 19 reports '' when the value is set from outside (a form reset),
          // which marked untouched forms as edited. A user cannot pick '': no item has it.
          if (next === '') return;
          const coerced = next as TValue;
          field.handleChange(coerced);
          onValueChange?.(coerced);
        }}
        disabled={disabled}
      >
        <SelectTrigger
          id={field.name}
          onBlur={field.handleBlur}
          aria-invalid={invalid || undefined}
          aria-required={required || undefined}
          data-testid={testId}
        >
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((opt) => (
            <SelectItem key={opt.value} value={opt.value} disabled={opt.disabled}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {description && <FieldDescription>{description}</FieldDescription>}
      {invalid && <FieldError errors={errors} />}
    </Field>
  );
}
