'use client';

import { extractGraphQLError } from '@roviq/graphql';
import { Field, FieldLabel, Input } from '@roviq/ui';
import type { useTranslations } from 'next-intl';
import { useId } from 'react';

/** Maps known timetable GraphQL error codes to localized messages. */
export function mapError(err: unknown, t: ReturnType<typeof useTranslations<'timetable'>>): string {
  const msg = extractGraphQLError(err, t('errors.generic'));
  for (const code of [
    'TIMETABLE_NAME_DUPLICATE',
    'TIMETABLE_TEACHER_CONFLICT',
    'TIMETABLE_ROOM_CONFLICT',
    'INVALID_STATE_TRANSITION',
    'INVALID_DATE_RANGE',
  ] as const) {
    if (msg.includes(code)) return t(`errors.${code}`);
  }
  return msg;
}

/** Native `<input type="time">` wrapped in a labelled Field (no TimeField in the kit). */
export function TimeInput({
  label,
  value,
  onChange,
  testId,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  testId?: string;
}) {
  const id = useId();
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        type="time"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        data-testid={testId}
      />
    </Field>
  );
}
