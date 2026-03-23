'use client';

import { useFormatDate, useFormatNumber, useI18nField } from '@roviq/i18n';
import {
  Badge,
  ScrollArea,
  Separator,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@roviq/ui';
import { useTranslations } from 'next-intl';
import type * as React from 'react';
import type { InvoiceNode } from './use-invoices';

interface InvoiceDetailProps {
  invoice: InvoiceNode | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-2 py-1.5">
      <span className="text-sm font-medium text-muted-foreground">{label}</span>
      <span className="text-sm break-all">{children}</span>
    </div>
  );
}

export function InvoiceDetail({ invoice, open, onOpenChange }: InvoiceDetailProps) {
  const t = useTranslations('billing');
  const { format } = useFormatDate();
  const { currency } = useFormatNumber();
  const ti = useI18nField();

  const formatDate = (date: Date) => format(date, 'dd MMM yyyy');
  const formatCurrency = (amount: number) => currency(amount);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[480px] sm:max-w-[480px]">
        <SheetHeader>
          <SheetTitle>{t('invoices.detail.title')}</SheetTitle>
          <SheetDescription>{t('invoices.detail.description')}</SheetDescription>
        </SheetHeader>

        {invoice && (
          <div className="flex-1 overflow-y-auto px-4">
            <ScrollArea className="h-[calc(100vh-120px)]">
              <div className="space-y-1 pt-4">
                <DetailRow label={t('invoices.detail.id')}>
                  <span className="font-mono text-xs">{invoice.id}</span>
                </DetailRow>
                <DetailRow label={t('invoices.detail.institute')}>
                  {ti(invoice.subscription?.institute?.name)}
                </DetailRow>

                <Separator className="my-2" />

                <DetailRow label={t('invoices.detail.amount')}>
                  {formatCurrency(Number(invoice.totalAmount) / 100)}
                </DetailRow>
                <DetailRow label={t('invoices.detail.currency')}>{invoice.currency}</DetailRow>
                <DetailRow label={t('invoices.detail.status')}>
                  <Badge>{t(`invoices.statuses.${invoice.status}`)}</Badge>
                </DetailRow>

                <Separator className="my-2" />

                <DetailRow label={t('invoices.detail.billingPeriodStart')}>
                  {invoice.periodStart ? formatDate(new Date(invoice.periodStart)) : '—'}
                </DetailRow>
                <DetailRow label={t('invoices.detail.billingPeriodEnd')}>
                  {invoice.periodEnd ? formatDate(new Date(invoice.periodEnd)) : '—'}
                </DetailRow>
                <DetailRow label={t('invoices.detail.dueDate')}>
                  {invoice.dueAt ? formatDate(new Date(invoice.dueAt)) : '—'}
                </DetailRow>
                <DetailRow label={t('invoices.detail.paidAt')}>
                  {invoice.paidAt ? formatDate(new Date(invoice.paidAt)) : '—'}
                </DetailRow>

                <Separator className="my-2" />

                <DetailRow label={t('invoices.detail.createdAt')}>
                  {formatDate(new Date(invoice.createdAt))}
                </DetailRow>
              </div>
            </ScrollArea>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
