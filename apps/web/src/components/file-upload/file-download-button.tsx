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

const ADMIN_EXPORT_DOWNLOAD = gql`
  mutation AdminExportReportDownloadUrl($fileId: ID!) {
    url: adminExportReportDownloadUrl(fileId: $fileId)
  }
`;

const DOWNLOAD = {
  institute: INSTITUTE_DOWNLOAD,
  admin: ADMIN_DOCUMENT_DOWNLOAD,
  adminExport: ADMIN_EXPORT_DOWNLOAD,
} as const;

export interface FileDownloadButtonProps {
  fileId: string;
  label: string;
  /**
   * Which link to ask for: `institute` checks the record's ability, `admin` a user document
   * (`read User`), `adminExport` a finished compliance export (`read Export`).
   */
  scope: keyof typeof DOWNLOAD;
  testId: string;
}

/**
 * Opens a sensitive file. Such files carry no link in lists; each click asks the server for a
 * 60-second link, which also writes the audit entry.
 */
export function FileDownloadButton({ fileId, label, scope, testId }: FileDownloadButtonProps) {
  const t = useTranslations('fileUpload');
  const [request, { loading }] = useMutation<{ url: string }, { fileId: string }>(DOWNLOAD[scope]);

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
