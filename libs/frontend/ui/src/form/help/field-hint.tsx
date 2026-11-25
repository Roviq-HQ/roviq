'use client';

import { cn } from '@roviq/ui/lib/utils';
import type { FieldHelpTopic } from './field-help';
import { useFormHelpMode } from './form-help-mode';
import { useHelpText } from './use-help-text';

/** The topic's one-sentence hint under the label; hidden in `ICON_ONLY` mode. */
export function FieldHint({
  topic,
  id,
  className,
}: {
  topic: FieldHelpTopic;
  id?: string;
  className?: string;
}) {
  const mode = useFormHelpMode();
  const text = useHelpText();
  if (mode !== 'ICON_AND_HINT' || !topic.hint) return null;
  return (
    <p
      id={id}
      data-slot="field-hint"
      className={cn('-mt-1 text-sm leading-normal text-muted-foreground', className)}
    >
      {text(topic.hint, topic.values)}
    </p>
  );
}
