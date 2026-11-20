'use client';

import { extractGraphQLErrorCode } from '@roviq/graphql';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Can,
} from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { Loader2, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { useDeleteStudentDocument } from '../use-students';

const { instituteStudents } = testIds;

const ERROR_KEYS: Record<string, 'notFound' | 'forbidden'> = {
  STUDENT_NOT_FOUND: 'notFound',
  FORBIDDEN: 'forbidden',
};

/** Remove action for one student document, behind a confirmation naming its type. */
export function RemoveDocumentButton({ documentId, type }: { documentId: string; type: string }) {
  const t = useTranslations('students.detail.documents');
  const [open, setOpen] = useState(false);
  const [removeDocument, { loading }] = useDeleteStudentDocument();
  const typeLabel = t(`types.${type}`, { default: type });

  const confirm = async () => {
    try {
      await removeDocument({ variables: { id: documentId } });
      toast.success(t('remove.success'));
      setOpen(false);
    } catch (err) {
      const code = extractGraphQLErrorCode(err);
      toast.error(t(`remove.${(code && ERROR_KEYS[code]) ?? 'error'}`));
      setOpen(false);
    }
  };

  return (
    <Can I="update" a="Student">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="text-rose-700 hover:bg-rose-50 print:hidden"
        title={t('remove.buttonTitle')}
        data-testid={instituteStudents.detailDocumentRemoveBtn(documentId)}
        onClick={() => setOpen(true)}
      >
        <Trash2 aria-hidden="true" className="size-4" />
        {t('remove.button')}
      </Button>
      <AlertDialog
        open={open}
        onOpenChange={(next) => {
          if (!loading) setOpen(next);
        }}
      >
        <AlertDialogContent data-testid={instituteStudents.detailDocumentRemoveDialog}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('remove.dialogTitle', { type: typeLabel })}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('remove.dialogDescription', { type: typeLabel })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={loading}
              data-testid={instituteStudents.detailDocumentRemoveCancelBtn}
            >
              {t('remove.cancel')}
            </AlertDialogCancel>
            {/* A plain button: AlertDialogAction would close the dialog before the mutation ends. */}
            <Button
              type="button"
              variant="destructive"
              disabled={loading}
              aria-busy={loading}
              title={t('remove.confirm')}
              data-testid={instituteStudents.detailDocumentRemoveConfirmBtn}
              onClick={() => void confirm()}
            >
              {loading && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}
              {loading ? t('remove.removing') : t('remove.confirm')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Can>
  );
}
