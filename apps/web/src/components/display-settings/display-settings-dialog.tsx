'use client';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  useMediaQuery,
} from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { useTranslations } from 'next-intl';
import { DisplaySettingsPanel } from './display-settings-panel';

const { displaySettings } = testIds;

/** A dialog on desktop and a bottom sheet on phones; the page underneath stays mounted. */
export function DisplaySettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('account.displaySettings');
  const isMobile = useMediaQuery('(max-width: 1024px)');

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          className="max-h-[85vh] overflow-y-auto"
          data-testid={displaySettings.dialog}
        >
          <SheetHeader>
            <SheetTitle>{t('title')}</SheetTitle>
            <SheetDescription>{t('description')}</SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-6">
            <DisplaySettingsPanel />
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto" data-testid={displaySettings.dialog}>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        <DisplaySettingsPanel />
      </DialogContent>
    </Dialog>
  );
}

/** The same settings as a card on My Account. */
export function DisplaySettingsCard() {
  const t = useTranslations('account.displaySettings');
  return (
    <Card data-testid={displaySettings.card}>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <DisplaySettingsPanel />
      </CardContent>
    </Card>
  );
}
