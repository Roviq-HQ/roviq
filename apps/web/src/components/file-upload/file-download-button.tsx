'use client';

import { gql, useMutation } from '@roviq/graphql';
import { Button } from '@roviq/ui';
import { FileDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

const INSTITUTE_DOWNLOAD = gql`
  mutation FileDownloadUrl($fileId: ID!) {
    url: fileDownloadUrl(fileId: $fileId)
  }
`;

const ADMIN_DOCUMENT_DOWNLOAD = gql`
  mutation AdminUserDocumentDownloadUrl($fileId: ID!) {
    url: adminUserDocumentDownloadUrl(fileId: $fileId)
  }
`;

export interface FileDownloadButtonProps {
  fileId: string;
  label: string;
  /** Which portal asks: the institute call checks the record's ability, the admin one `read User`. */
  scope: 'institute' | 'admin';
  testId: string;
}

/**
 * Opens a sensitive file. Such files carry no link in lists; each click asks the server for a
 * 60-second link, which also writes the audit entry.
 */
export function FileDownloadButton({ fileId, label, scope, testId }: FileDownloadButtonProps) {
  const t = useTranslations('fileUpload');
  const [request, { loading }] = useMutation<{ url: string }, { fileId: string }>(
    scope === 'admin' ? ADMIN_DOCUMENT_DOWNLOAD : INSTITUTE_DOWNLOAD,
  );

  const open = async () => {
    // Opened before the request so the browser ties the tab to the click and does not block it.
    const tab = window.open('', '_blank');
    if (tab) tab.opener = null;
    try {
      const { data } = await request({ variables: { fileId } });
      if (!data?.url) throw new Error('No download URL returned');
      if (tab) tab.location.replace(data.url);
      else window.location.assign(data.url);
    } catch {
      tab?.close();
      toast.error(t('download.failed'));
    }
  };

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => void open()}
      disabled={loading}
      aria-busy={loading}
      title={label}
      data-testid={testId}
    >
      <FileDown aria-hidden="true" className="size-3" />
      {label}
    </Button>
  );
}
