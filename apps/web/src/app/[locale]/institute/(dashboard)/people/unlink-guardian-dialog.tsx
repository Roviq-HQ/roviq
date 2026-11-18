'use client';

import { extractGraphQLErrorCode } from '@roviq/graphql';
import { useI18nField } from '@roviq/i18n';
import {
  Alert,
  AlertDescription,
  Button,
  Can,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldLabel,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  Skeleton,
  useMediaQuery,
} from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { Info, Unlink } from 'lucide-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import { toast } from 'sonner';
import { useUnlinkGuardianFromStudent } from './guardians/use-guardians';
import { useStudentGuardians } from './students/use-students';

const { institutePeople } = testIds;

const KNOWN_ERROR_CODES = [
  'GUARDIAN_LINK_NOT_FOUND',
  'LAST_GUARDIAN_CANNOT_BE_DELETED',
  'PRIMARY_GUARDIAN_REQUIRED',
  'REPLACEMENT_PRIMARY_GUARDIAN_INVALID',
] as const;
type KnownErrorCode = (typeof KNOWN_ERROR_CODES)[number];

function isKnownErrorCode(code: string | null): code is KnownErrorCode {
  return KNOWN_ERROR_CODES.some((known) => known === code);
}

interface UnlinkGuardianButtonProps {
  linkId: string;
  studentProfileId: string;
  guardianProfileId: string;
  studentName: string;
  guardianName: string;
}

/**
 * Unlinks one guardian from one student. Shared by the student Guardians tab
 * and the guardian Children tab. Reads the student's full guardian list so it
 * can block the last guardian and ask for a new primary contact up front,
 * mirroring the rules `unlinkGuardianFromStudent` enforces.
 */
export function UnlinkGuardianButton(props: UnlinkGuardianButtonProps) {
  const t = useTranslations('peopleLinks');
  const [open, setOpen] = React.useState(false);

  return (
    <Can I="update" a="Guardian">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="text-destructive"
        onClick={() => setOpen(true)}
        title={t('unlink.buttonTitle', {
          guardian: props.guardianName,
          student: props.studentName,
        })}
        data-testid={institutePeople.unlinkBtn(props.linkId)}
      >
        <Unlink aria-hidden="true" className="size-4" />
        {t('unlink.button')}
      </Button>
      {open && <UnlinkGuardianDialog {...props} open={open} onOpenChange={setOpen} />}
    </Can>
  );
}

function UnlinkGuardianDialog({
  studentProfileId,
  guardianProfileId,
  studentName,
  guardianName,
  open,
  onOpenChange,
}: UnlinkGuardianButtonProps & { open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useTranslations('peopleLinks');
  const tError = useTranslations('error');
  const resolveI18n = useI18nField();
  const isMobile = useMediaQuery('(max-width: 1024px)');
  const { data, loading } = useStudentGuardians(studentProfileId);
  const [unlink, { loading: unlinking }] = useUnlinkGuardianFromStudent();
  const [replacementId, setReplacementId] = React.useState('');

  const links = data?.listStudentGuardians ?? [];
  const current = links.find((l) => l.guardianProfileId === guardianProfileId);
  const others = links.filter((l) => l.guardianProfileId !== guardianProfileId);
  const isLast = !loading && others.length === 0;
  const needsReplacement = !!current?.isPrimaryContact && !isLast;
  const canSubmit =
    !loading && !isLast && (!needsReplacement || replacementId !== '') && !unlinking;
  const names = { guardian: guardianName, student: studentName };

  async function handleUnlink() {
    try {
      await unlink({
        variables: {
          input: {
            guardianProfileId,
            studentProfileId,
            ...(needsReplacement ? { newPrimaryGuardianId: replacementId } : {}),
          },
        },
      });
      toast.success(t('unlink.success', names));
      onOpenChange(false);
    } catch (err) {
      const code = extractGraphQLErrorCode(err);
      toast.error(t('unlink.failed', names), {
        description: isKnownErrorCode(code)
          ? t(`unlink.errors.${code}`, names)
          : tError('errorDescription'),
        duration: Number.POSITIVE_INFINITY,
      });
    }
  }

  const body = loading ? (
    <Skeleton className="h-20 w-full" />
  ) : isLast ? (
    <Alert data-testid={institutePeople.unlinkLastGuardianNotice}>
      <Info aria-hidden="true" className="size-4" />
      <AlertDescription>{t('unlink.lastGuardian', names)}</AlertDescription>
    </Alert>
  ) : (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t('unlink.consequence', names)}</p>
      {needsReplacement && (
        <Field>
          <FieldLabel htmlFor="unlink-replacement">{t('unlink.replacementLabel')}</FieldLabel>
          <p className="text-sm text-muted-foreground">{t('unlink.primaryNotice', names)}</p>
          <Select value={replacementId} onValueChange={setReplacementId}>
            <SelectTrigger
              id="unlink-replacement"
              data-testid={institutePeople.unlinkReplacementSelect}
            >
              <SelectValue placeholder={t('unlink.replacementPlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              {others.map((g) => (
                <SelectItem key={g.guardianProfileId} value={g.guardianProfileId}>
                  {[resolveI18n(g.firstName), resolveI18n(g.lastName)].filter(Boolean).join(' ')}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      )}
    </div>
  );

  const actions = (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => onOpenChange(false)}
        disabled={unlinking}
        data-testid={institutePeople.unlinkCancelBtn}
      >
        {t('unlink.cancel')}
      </Button>
      <Button
        type="button"
        variant="destructive"
        onClick={handleUnlink}
        disabled={!canSubmit}
        data-testid={institutePeople.unlinkConfirmBtn}
      >
        {unlinking ? t('unlink.unlinking') : t('unlink.confirm')}
      </Button>
    </>
  );

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          className="max-h-[90vh] overflow-y-auto"
          data-testid={institutePeople.unlinkDialog}
        >
          <SheetHeader>
            <SheetTitle>{t('unlink.title', names)}</SheetTitle>
            <SheetDescription className="sr-only">
              {t('unlink.consequence', names)}
            </SheetDescription>
          </SheetHeader>
          <div className="px-4">{body}</div>
          <SheetFooter className="sticky bottom-0 border-t bg-background pt-4">
            {actions}
          </SheetFooter>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid={institutePeople.unlinkDialog}>
        <DialogHeader>
          <DialogTitle>{t('unlink.title', names)}</DialogTitle>
          <DialogDescription className="sr-only">
            {t('unlink.consequence', names)}
          </DialogDescription>
        </DialogHeader>
        {body}
        <DialogFooter>{actions}</DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
