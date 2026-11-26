'use client';

import type { AnyFormApi } from '@tanstack/react-form';
import { useCallback, useSyncExternalStore } from 'react';

export interface FormSubmitError {
  title: string;
  description?: string;
}

interface Shown {
  error: FormSubmitError;
  stop: () => void;
}

// Keyed by the form's store: `useAppForm` and `onSubmit`'s `formApi` are different objects that
// share it.
const shown = new WeakMap<object, Shown>();
const listeners = new WeakMap<object, Set<() => void>>();

function notify(form: AnyFormApi): void {
  for (const listener of listeners.get(form.store) ?? []) listener();
}

/**
 * Shows a failure of the whole submit (network, permission, conflict) in the form, above its
 * submit button, until the next submit starts.
 *
 * Kept outside TanStack's `errorMap`: a form-level error there makes `canSubmit` false, which
 * would disable the button the person needs to try again. `submissionAttempts` goes up at the
 * very start of `handleSubmit` (also when validation then fails), so it marks the next attempt
 * even though this is usually called from inside `onSubmit`, while `isSubmitting` is still true.
 */
export function setFormSubmitError(form: AnyFormApi, error: FormSubmitError): void {
  shown.get(form.store)?.stop();
  const attempt = form.state.submissionAttempts;
  const subscription = form.store.subscribe((state) => {
    if (state.submissionAttempts !== attempt) clearFormSubmitError(form);
  });
  shown.set(form.store, { error: { ...error }, stop: () => subscription.unsubscribe() });
  notify(form);
}

export function clearFormSubmitError(form: AnyFormApi): void {
  const current = shown.get(form.store);
  if (!current) return;
  current.stop();
  shown.delete(form.store);
  notify(form);
}

export function useFormSubmitError(form: AnyFormApi): FormSubmitError | undefined {
  const subscribe = useCallback(
    (listener: () => void) => {
      const set = listeners.get(form.store) ?? new Set<() => void>();
      listeners.set(form.store, set);
      set.add(listener);
      return () => {
        set.delete(listener);
      };
    },
    [form],
  );
  return useSyncExternalStore(
    subscribe,
    () => shown.get(form.store)?.error,
    () => undefined,
  );
}
