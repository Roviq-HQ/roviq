'use client';

import type { RulePreviewResult } from '@roviq/graphql/generated';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { usePersonName } from '@web/hooks/use-person-name';
import { useTranslations } from 'next-intl';

/** The sample of students a group rule matches, by name and admission number. */
export function RulePreviewSample({ members }: { members: RulePreviewResult['sampleMembers'] }) {
  const t = useTranslations('groups');
  const personName = usePersonName();
  return (
    <ul className="max-h-64 space-y-1 overflow-y-auto rounded border bg-muted/30 p-3">
      {members.map((m) => (
        <li
          key={m.membershipId}
          className="flex items-baseline justify-between gap-2 text-sm"
          data-testid={testIds.instituteGroups.previewMember(m.membershipId)}
        >
          <span className="truncate">{personName(m.firstName, m.lastName)}</span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {t('previewSample.admissionNumber', { number: m.admissionNumber })}
          </span>
        </li>
      ))}
    </ul>
  );
}
