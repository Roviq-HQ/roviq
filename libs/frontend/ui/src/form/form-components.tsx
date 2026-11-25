'use client';

import type { VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button, type buttonVariants } from '../components/ui/button';
import { useFormContext } from './use-app-form';

/** Ties a submit button to its TanStack form, so a refused submit can find the form's fields. */
export const FORM_ID_ATTRIBUTE = 'data-form-id';

export interface SubmitButtonProps extends VariantProps<typeof buttonVariants> {
  /** Label shown when the form is idle. */
  children: ReactNode;
  /** Label shown while `isSubmitting` is true. Defaults to `children`. */
  submittingLabel?: ReactNode;
  /** Force-disable the button regardless of form state. */
  disabled?: boolean;
  testId?: string;
  className?: string;
}

/**
 * Submit button bound to the form's `isSubmitting` state. It stays enabled while the form is
 * invalid: pressing it shows every field's error and focuses the first one.
 * Subscribes via `form.Subscribe` so the surrounding form does not re-render
 * on every keystroke.
 *
 * Must be rendered inside `<form.AppForm>` so the form context is available.
 */
export function SubmitButton({
  children,
  submittingLabel,
  disabled,
  testId,
  className,
  variant,
  size,
}: SubmitButtonProps) {
  const form = useFormContext();
  return (
    <form.Subscribe selector={(state) => state.isSubmitting}>
      {(isSubmitting) => (
        <Button
          type="submit"
          variant={variant}
          size={size}
          disabled={disabled || isSubmitting}
          data-testid={testId}
          {...{ [FORM_ID_ATTRIBUTE]: form.formId }}
          className={className}
        >
          {isSubmitting && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}
          {isSubmitting && submittingLabel ? submittingLabel : children}
        </Button>
      )}
    </form.Subscribe>
  );
}
