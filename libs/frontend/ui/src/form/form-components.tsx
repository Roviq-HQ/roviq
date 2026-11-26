'use client';

import type { VariantProps } from 'class-variance-authority';
import { AlertCircle, Loader2 } from 'lucide-react';
import { type ReactNode, useEffect, useRef } from 'react';
import { Alert, AlertDescription, AlertTitle } from '../components/ui/alert';
import { Button, type buttonVariants } from '../components/ui/button';
import { testIds } from '../testing/testid-registry';
import { useFormSubmitError } from './submit-error';
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

export interface SubmitErrorProps {
  className?: string;
}

/**
 * The failure set with `setFormSubmitError`, shown where the person is about to press submit
 * again. Render it directly above the submit button, inside `<form.AppForm>`.
 */
export function SubmitError({ className }: SubmitErrorProps) {
  const form = useFormContext();
  const error = useFormSubmitError(form);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = ref.current;
    // Test DOMs (jsdom, some happy-dom versions) lack scrollIntoView.
    if (error && element && typeof element.scrollIntoView === 'function') {
      element.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [error]);

  if (!error) return null;
  return (
    <Alert
      ref={ref}
      variant="destructive"
      data-testid={testIds.form.submitError}
      className={className}
    >
      <AlertCircle aria-hidden="true" />
      <AlertTitle className="line-clamp-none">{error.title}</AlertTitle>
      {error.description && <AlertDescription>{error.description}</AlertDescription>}
    </Alert>
  );
}
