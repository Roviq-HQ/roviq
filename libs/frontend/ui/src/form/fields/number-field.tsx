'use client';

import { Field, FieldDescription, FieldError } from '@roviq/ui/components/ui/field';
import { Input } from '@roviq/ui/components/ui/input';
import { fieldErrorMessages } from '@roviq/ui/form/errors';
import { FieldLabelWithInfo } from '@roviq/ui/form/fields/field-label-with-info';
import type { FieldHelpTopic } from '@roviq/ui/form/help/field-help';
import { useFieldHelpIds } from '@roviq/ui/form/help/use-field-help-ids';
import { useFieldContext } from '@roviq/ui/form/use-app-form';
import type { ReactNode } from 'react';

export interface NumberFieldProps {
  label: ReactNode;
  description?: ReactNode;
  /**
   * Optional slot rendered inline after the label text — typically a
   * `<FieldInfoPopover>` but any `ReactNode` is accepted.
   */
  info?: ReactNode;
  /** Help topic from `apps/web/src/help`; replaces `info`. */
  help?: FieldHelpTopic;
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number;
  testId?: string;
  disabled?: boolean;
  required?: boolean;
}

/**
 * Numeric input that emits `number | undefined`. Empty input → `undefined`
 * (mirrors the `optionalInt` Zod helper). Use for plain integers and decimals;
 * for currency, use `MoneyField` instead.
 */
export function NumberField({
  label,
  description,
  info,
  help,
  placeholder,
  min,
  max,
  step,
  testId,
  disabled,
  required,
}: NumberFieldProps) {
  const field = useFieldContext<number | undefined>();
  const errors = fieldErrorMessages(field);
  const invalid = errors.length > 0;
  const raw = field.state.value;
  const value = typeof raw === 'number' && !Number.isNaN(raw) ? String(raw) : '';
  const ids = useFieldHelpIds({
    name: field.name,
    help,
    hasDescription: Boolean(description),
    invalid,
  });
  return (
    <Field data-invalid={invalid || undefined}>
      <FieldLabelWithInfo htmlFor={field.name} info={info} help={help} hintId={ids.hintId}>
        {label}
      </FieldLabelWithInfo>
      <Input
        id={field.name}
        name={field.name}
        type="number"
        inputMode="numeric"
        value={value}
        onChange={(e) => {
          const next = e.target.value;
          if (next === '') {
            field.handleChange(undefined);
            return;
          }
          const parsed = Number(next);
          field.handleChange(Number.isNaN(parsed) ? undefined : parsed);
        }}
        onBlur={field.handleBlur}
        placeholder={placeholder}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        required={required}
        aria-invalid={invalid || undefined}
        aria-describedby={ids.describedBy}
        data-testid={testId}
      />
      {description && <FieldDescription id={ids.descriptionId}>{description}</FieldDescription>}
      {invalid && <FieldError id={ids.errorId} errors={errors} />}
    </Field>
  );
}
