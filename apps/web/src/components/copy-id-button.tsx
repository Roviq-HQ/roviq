'use client';

import { Button } from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { Check, Copy } from 'lucide-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import { toast } from 'sonner';

/**
 * Copies a full id for support or a search, and confirms with a "Copied!" toast.
 * `rowKey` names the row or place the button sits in: the same id can appear in several rows.
 */
export function CopyIdButton({
  value,
  name,
  rowKey,
}: {
  value: string;
  name: string;
  rowKey: string;
}) {
  const t = useTranslations('common.copyId');
  const [copied, setCopied] = React.useState(false);
  const label = t('label', { name });

  React.useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = async (event: React.MouseEvent) => {
    // Rows open on click; copying must not.
    event.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // The browser refused clipboard access (permission or an insecure page).
      toast.error(t('failed'));
      return;
    }
    setCopied(true);
    toast.success(t('copied'), { duration: 2000 });
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      title={label}
      aria-label={label}
      onClick={copy}
      data-testid={testIds.copyId.button(rowKey, value)}
    >
      {copied ? <Check className="text-emerald-600" /> : <Copy />}
    </Button>
  );
}
