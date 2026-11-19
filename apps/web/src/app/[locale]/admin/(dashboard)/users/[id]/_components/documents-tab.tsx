'use client';

import { useFormatDate } from '@roviq/i18n';
import {
  Badge,
  Card,
  CardContent,
  Empty,
  EmptyHeader,
  EmptyTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { FileDownloadButton } from '@web/components/file-upload/file-download-button';
import { useTranslations } from 'next-intl';
import type { UserDetail } from '../../types';

const { adminUserDetail } = testIds;

type Doc = UserDetail['documents'][number];

function verification(doc: Doc): 'verified' | 'rejected' | 'pending' {
  if (doc.isVerified) return 'verified';
  return doc.rejectionReason ? 'rejected' : 'pending';
}

const VERIFICATION_VARIANT = {
  verified: 'default',
  rejected: 'destructive',
  pending: 'secondary',
} as const;

export function DocumentsTab({ documents }: { documents: UserDetail['documents'] }) {
  const t = useTranslations('adminUsers.documents');
  const { format } = useFormatDate();

  if (documents.length === 0) {
    return (
      <Empty className="py-12" data-testid={adminUserDetail.empty('documents')}>
        <EmptyHeader>
          <EmptyTitle>{t('empty')}</EmptyTitle>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('columns.type')}</TableHead>
              <TableHead>{t('columns.files')}</TableHead>
              <TableHead>{t('columns.status')}</TableHead>
              <TableHead>{t('columns.uploaded')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {documents.map((doc) => {
              const state = verification(doc);
              return (
                <TableRow key={doc.id} data-testid={adminUserDetail.documentRow(doc.id)}>
                  <TableCell>
                    <div className="font-medium">{t(`types.${doc.type}`)}</div>
                    {doc.description && (
                      <div className="text-xs text-muted-foreground">{doc.description}</div>
                    )}
                    {doc.referenceNumber && (
                      <div className="font-mono text-xs text-muted-foreground">
                        {doc.referenceNumber}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-2">
                      {doc.files.map((file, i) => (
                        <FileDownloadButton
                          key={file.id}
                          fileId={file.id}
                          scope="admin"
                          testId={adminUserDetail.documentFileBtn(file.id)}
                          label={t('file', { n: i + 1 })}
                        />
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={VERIFICATION_VARIANT[state]}
                      title={doc.rejectionReason ?? undefined}
                    >
                      {t(`status.${state}`)}
                    </Badge>
                  </TableCell>
                  <TableCell>{format(new Date(doc.uploadedAt), 'dd/MM/yyyy')}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
