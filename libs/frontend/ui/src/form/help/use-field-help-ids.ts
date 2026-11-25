'use client';

import type { FieldHelpTopic } from './field-help';
import { useFormHelpMode } from './form-help-mode';

/**
 * Ids for the hint, description and error of one field, and the input's
 * `aria-describedby` listing only those that are rendered.
 */
export function useFieldHelpIds({
  name,
  help,
  hasDescription,
  invalid,
}: {
  name: string;
  help?: FieldHelpTopic;
  hasDescription: boolean;
  invalid: boolean;
}) {
  const mode = useFormHelpMode();
  const hintId = `${name}-hint`;
  const descriptionId = `${name}-description`;
  const errorId = `${name}-error`;
  const hintShown = mode === 'ICON_AND_HINT' && Boolean(help?.hint);
  const ids = [hintShown && hintId, hasDescription && descriptionId, invalid && errorId].filter(
    (id): id is string => typeof id === 'string',
  );
  return {
    hintId,
    descriptionId,
    errorId,
    describedBy: ids.length > 0 ? ids.join(' ') : undefined,
  };
}
