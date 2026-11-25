'use client';

import { createFormHook, createFormHookContexts } from '@tanstack/react-form';
import { CheckboxField } from './fields/checkbox-field';
import { DateField } from './fields/date-field';
import { I18nField } from './fields/i18n-field';
import { MoneyField } from './fields/money-field';
import { NumberField } from './fields/number-field';
import { PhoneField } from './fields/phone-field';
import { SelectField } from './fields/select-field';
import { SwitchField } from './fields/switch-field';
import { TextField } from './fields/text-field';
import { TextareaField } from './fields/textarea-field';
import { SubmitButton } from './form-components';

export const { fieldContext, formContext, useFieldContext, useFormContext } =
  createFormHookContexts();

/**
 * Typed form factory for the Roviq web app.
 *
 * Built on TanStack Form's `createFormHook` so every consumer gets:
 *   - `useAppForm({ defaultValues, validators, onSubmit })`
 *   - typed `<form.AppField>` whose render-prop exposes the registered
 *     field components (`field.TextField`, `field.SelectField`, …)
 *   - typed `<form.AppForm>` for form-level components (`form.SubmitButton`)
 *   - `withForm` HOC for splitting large forms into reusable chunks
 *
 * Cascading-select pattern: when one field's value drives another's options
 * (e.g. academicYear → standard → section), subscribe to the parent via
 * `useStore(form.store, (s) => s.values.academicYear)` — render-prop trees
 * cannot read sibling field state directly. The kit deliberately does not
 * abstract this; it is already idiomatic TanStack Form.
 */
const { useAppForm: useBaseAppForm, withForm } = createFormHook({
  fieldContext,
  formContext,
  fieldComponents: {
    CheckboxField,
    DateField,
    I18nField,
    MoneyField,
    NumberField,
    PhoneField,
    SelectField,
    SwitchField,
    TextareaField,
    TextField,
  },
  formComponents: {
    SubmitButton,
  },
});

/**
 * After a refused submit, moves focus to the first field showing an error, in page order.
 * Runs on the next frame: the errors render only once the submit has marked every field touched.
 */
function focusFirstInvalidField(fieldNames: string[]): void {
  if (typeof window === 'undefined') return;
  const returnFocus = document.activeElement;
  window.requestAnimationFrame(() => {
    const fieldElement = fieldNames
      .map((name) => document.getElementById(name))
      .find((el): el is HTMLElement => el !== null);
    const root =
      fieldElement?.closest('form') ??
      (returnFocus instanceof HTMLElement ? returnFocus.closest('form') : null);
    const target = root?.querySelector<HTMLElement>('[aria-invalid="true"]');
    target?.focus();
  });
}

export const useAppForm: typeof useBaseAppForm = (options) =>
  useBaseAppForm({
    ...options,
    onSubmitInvalid: (props) => {
      options.onSubmitInvalid?.(props);
      const fieldMeta = props.formApi.state.fieldMeta as Record<
        string,
        { errors?: ReadonlyArray<unknown> } | undefined
      >;
      focusFirstInvalidField(
        Object.keys(fieldMeta).filter((name) => (fieldMeta[name]?.errors?.length ?? 0) > 0),
      );
    },
  });

export { withForm };
