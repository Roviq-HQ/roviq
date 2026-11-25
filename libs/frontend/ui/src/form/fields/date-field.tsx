'use client';

import { Field, FieldDescription, FieldError } from '@roviq/ui/components/ui/field';
import { Input } from '@roviq/ui/components/ui/input';
import { fieldErrorMessages } from '@roviq/ui/form/errors';
import { FieldLabelWithInfo } from '@roviq/ui/form/fields/field-label-with-info';
import type { FieldHelpTopic } from '@roviq/ui/form/help/field-help';
import { useFieldHelpIds } from '@roviq/ui/form/help/use-field-help-ids';
import { useFieldContext } from '@roviq/ui/form/use-app-form';
import type { ReactNode } from 'react';

export interface DateFieldProps {
  label: ReactNode;
  description?: ReactNode;
  /**
   * Optional slot rendered inline after the label text — typically a
   * `<FieldInfoPopover>` but any `ReactNode` is accepted.
   */
  info?: ReactNode;
  /** Help topic from `apps/web/src/help`; replaces `info`. */
  help?: FieldHelpTopic;
  testId?: string;
  disabled?: boolean;
  required?: boolean;
  /** ISO date `YYYY-MM-DD`. Forwarded to `<input type="date">` min attr. */
  min?: string;
  /** ISO date `YYYY-MM-DD`. Forwarded to `<input type="date">` max attr. */
  max?: string;
}

/**
 * `<input type="date">` field. Emits `string` in `YYYY-MM-DD` format (the
 * native wire format). Display formatting (DD/MM/YYYY for IN locale) lives
 * downstream in `useFormatDate()` for read-only views.
 *
 * Empty input emits `''` (NOT `undefined`) — pair with `emptyStringToUndefined`
 * in your Zod schema for optional date fields.
 */
export function DateField({
  label,
  description,
  info,
  help,
  testId,
  disabled,
  required,
  min,
  max,
}: DateFieldProps) {
  const field = useFieldContext<string | undefined>();
  const errors = fieldErrorMessages(field);
  const invalid = errors.length > 0;
  const value = typeof field.state.value === 'string' ? field.state.value : '';
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
        type="date"
        value={value}
        onChange={(e) => field.handleChange(e.target.value)}
        onBlur={field.handleBlur}
        disabled={disabled}
        required={required}
        min={min}
        max={max}
        aria-invalid={invalid || undefined}
        aria-describedby={ids.describedBy}
        data-testid={testId}
      />
      {description && <FieldDescription id={ids.descriptionId}>{description}</FieldDescription>}
      {invalid && <FieldError id={ids.errorId} errors={errors} />}
    </Field>
  );
}
