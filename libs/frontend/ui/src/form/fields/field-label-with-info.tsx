'use client';

import { FieldLabel } from '@roviq/ui/components/ui/field';
import type { FieldHelpTopic } from '@roviq/ui/form/help/field-help';
import { FieldHelpButton } from '@roviq/ui/form/help/field-help-button';
import { FieldHint } from '@roviq/ui/form/help/field-hint';
import type { ReactNode } from 'react';

export interface FieldLabelWithInfoProps {
  /** Optional — omit for legend-style labels (FieldLegend, CardTitle). */
  htmlFor?: string;
  children: ReactNode;
  /** Inline slot after the label — the older way; new code passes `help`. */
  info?: ReactNode;
  /** Help topic: the ⓘ button, and the hint under the label in `ICON_AND_HINT` mode. */
  help?: FieldHelpTopic;
  /** Id of the hint, listed in the input's `aria-describedby` (see `useFieldHelpIds`). */
  hintId?: string;
  /** Option labels as the form shows them, for the topic's per-option help. */
  optionLabels?: Readonly<Record<string, string>>;
  /** Shows a required marker after the label text. */
  required?: boolean;
}

export function FieldLabelWithInfo({
  htmlFor,
  children,
  info,
  help,
  hintId,
  optionLabels,
  required,
}: FieldLabelWithInfoProps) {
  const label = (
    <FieldLabel htmlFor={htmlFor}>
      {children}
      {required && (
        <span className="text-destructive" aria-hidden="true">
          *
        </span>
      )}
    </FieldLabel>
  );
  const button = help ? (
    <FieldHelpButton
      topic={help}
      fieldLabel={typeof children === 'string' ? children : undefined}
      optionLabels={optionLabels}
    />
  ) : (
    info
  );
  // The button is a sibling of the label, not inside it, so the label names only the input.
  const row = button ? (
    <span className="flex items-center gap-2">
      {label}
      {button}
    </span>
  ) : (
    label
  );
  if (!help) return row;
  return (
    <>
      {row}
      <FieldHint topic={help} id={hintId} />
    </>
  );
}
