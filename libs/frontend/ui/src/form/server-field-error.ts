import type { AnyFormApi } from '@tanstack/react-form';

type FieldName<TForm extends AnyFormApi> = Parameters<TForm['getFieldValue']>[0];

// One live watcher per form and field, so a second rejection replaces the first. Keyed by the
// form's store: `useAppForm` and `onSubmit`'s `formApi` are different objects that share it.
const watchers = new WeakMap<object, Map<string, () => void>>();

/**
 * Shows a server rejection under a field and removes it as soon as that field's value changes.
 *
 * TanStack Form only clears an error it did not receive from a validator when the same
 * validator slot next reports one, so a hand-set error sticks after the user fixes the value
 * and keeps the submit button disabled. The error therefore goes in the dedicated `onServer`
 * slot (never rewritten by the form's own validators) and the field value is watched here.
 * `alsoClearOnChangeOf` names other fields the server derived its verdict from. The message
 * survives the field being unmounted and mounted again.
 */
export function setServerFieldError<TForm extends AnyFormApi>(
  form: TForm,
  field: FieldName<TForm>,
  message: string,
  { alsoClearOnChangeOf = [] }: { alsoClearOnChangeOf?: FieldName<TForm>[] } = {},
): void {
  const byField = watchers.get(form.store) ?? new Map<string, () => void>();
  watchers.set(form.store, byField);
  const key = String(field);
  byField.get(key)?.();

  const show = () =>
    form.setFieldMeta(field, (prev) => ({
      ...prev,
      isTouched: true,
      errorMap: { ...prev.errorMap, onServer: message },
    }));
  show();

  const watched = [field, ...alsoClearOnChangeOf];
  const rejectedValues = watched.map((name) => form.getFieldValue(name));
  const subscription = form.store.subscribe(() => {
    if (watched.every((name, i) => Object.is(form.getFieldValue(name), rejectedValues[i]))) {
      // TanStack resets a field's meta when its component unmounts (a wizard step, a tab, and
      // every mount under React StrictMode), which would drop a rejection the person has not
      // answered yet.
      if (form.getFieldMeta(field)?.errorMap.onServer !== message) show();
      return;
    }
    stop();
    form.setFieldMeta(field, (prev) =>
      prev.errorMap.onServer === message
        ? { ...prev, errorMap: { ...prev.errorMap, onServer: undefined } }
        : prev,
    );
  });
  function stop() {
    subscription.unsubscribe();
    if (byField.get(key) === stop) byField.delete(key);
  }
  byField.set(key, stop);
}
