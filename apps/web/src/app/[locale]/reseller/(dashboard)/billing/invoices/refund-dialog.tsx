'use client';

import { gql, useMutation, useQuery } from '@roviq/graphql';
import { useFormatDate, useFormatNumber } from '@roviq/i18n';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLabelWithInfo,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { refundHelp } from '@web/help/reseller-billing/refund.help';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import { toast } from 'sonner';
import { useResellerBillingErrorMessage } from '../use-reseller-billing-error-message';
import { InvoicePaymentsDocument, IssueRefundDocument } from './refund-dialog.generated';

const { resellerBillingInvoices: ids } = testIds;

export const INVOICE_PAYMENTS = gql`
  query InvoicePayments($invoiceId: ID!) {
    invoicePayments(invoiceId: $invoiceId) {
      id
      status
      method
      amountPaise
      refundedAmountPaise
      paidAt
      createdAt
      utrNumber
      receiptNumber
    }
  }
`;

export const ISSUE_REFUND = gql`
  mutation IssueRefund($paymentId: ID!, $input: RefundInput!) {
    issueRefund(paymentId: $paymentId, input: $input) {
      id
      status
      paidAmount
    }
  }
`;

const REFUNDABLE_STATUSES: readonly string[] = ['SUCCEEDED', 'PARTIALLY_REFUNDED'];

interface RefundDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoiceId: string;
}

export function RefundDialog({ open, onOpenChange, invoiceId }: RefundDialogProps) {
  const t = useTranslations('billing');
  const errorMessage = useResellerBillingErrorMessage();
  const { currency: formatCurrency } = useFormatNumber();
  const { format } = useFormatDate();
  const { data, loading, error } = useQuery(InvoicePaymentsDocument, {
    variables: { invoiceId },
    skip: !open,
    fetchPolicy: 'network-only',
  });
  const [issueRefund] = useMutation(IssueRefundDocument, { refetchQueries: ['Invoices'] });
  const [paymentId, setPaymentId] = React.useState('');
  const [amount, setAmount] = React.useState('');
  const [reason, setReason] = React.useState('');
  const [amountError, setAmountError] = React.useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  const refundable = React.useMemo(
    () =>
      (data?.invoicePayments ?? [])
        .filter((p) => REFUNDABLE_STATUSES.includes(p.status))
        .map((p) => ({
          ...p,
          remainingPaise: Number(p.amountPaise) - Number(p.refundedAmountPaise ?? 0),
        }))
        .filter((p) => p.remainingPaise > 0),
    [data],
  );
  const selected = refundable.find((p) => p.id === paymentId) ?? null;

  React.useEffect(() => {
    if (!open) return;
    setReason('');
    setAmountError(null);
    setPaymentId(refundable.length === 1 ? refundable[0].id : '');
  }, [open, refundable]);

  React.useEffect(() => {
    setAmount(selected ? paiseToRupees(selected.remainingPaise) : '');
    setAmountError(null);
  }, [selected]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected) return;
    const amountPaise = rupeesToPaise(amount);
    if (amountPaise === null || amountPaise <= 0) {
      setAmountError(t('invoices.refund.amountInvalid'));
      return;
    }
    if (amountPaise > selected.remainingPaise) {
      setAmountError(
        t('invoices.refund.amountExceeds', { max: formatCurrency(selected.remainingPaise / 100) }),
      );
      return;
    }
    setIsSubmitting(true);
    try {
      await issueRefund({
        variables: {
          paymentId: selected.id,
          input: { amountPaise: String(amountPaise), reason: reason || undefined },
        },
      });
      toast.success(t('invoices.refund.success'));
      onOpenChange(false);
    } catch (err) {
      toast.error(errorMessage(err, t('invoices.refund.error')));
    } finally {
      setIsSubmitting(false);
    }
  };

  const optionLabel = (p: (typeof refundable)[number]) =>
    t('invoices.refund.paymentOption', {
      method: t(`invoices.recordPayment.methods.${p.method}`),
      date: format(new Date(p.paidAt ?? p.createdAt), 'dd MMM yyyy'),
      paid: formatCurrency(Number(p.amountPaise) / 100),
      refunded: formatCurrency(Number(p.refundedAmountPaise ?? 0) / 100),
      remaining: formatCurrency(p.remainingPaise / 100),
    });

  const noRefundable = !loading && !error && refundable.length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{t('invoices.refund.title')}</DialogTitle>
          <DialogDescription>{t('invoices.refund.description')}</DialogDescription>
        </DialogHeader>
        {loading && (
          <Skeleton className="h-24 w-full" aria-label={t('invoices.refund.loadingPayments')} />
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {t('invoices.refund.loadError')}
          </p>
        )}
        {noRefundable && (
          <p className="text-sm text-muted-foreground" data-testid={ids.refundNoPayment}>
            {t('invoices.refund.noRefundable')}
          </p>
        )}
        {!loading && !error && (
          <form noValidate onSubmit={handleSubmit}>
            <FieldGroup>
              {refundable.length > 0 && (
                <Field>
                  <FieldLabel htmlFor="refundPayment">{t('invoices.refund.payment')}</FieldLabel>
                  <Select value={paymentId} onValueChange={(value) => value && setPaymentId(value)}>
                    <SelectTrigger id="refundPayment" data-testid={ids.refundPaymentSelect}>
                      <SelectValue placeholder={t('invoices.refund.paymentPlaceholder')} />
                    </SelectTrigger>
                    <SelectContent>
                      {refundable.map((p) => (
                        <SelectItem
                          key={p.id}
                          value={p.id}
                          data-testid={ids.refundPaymentOption(p.id)}
                        >
                          {optionLabel(p)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              )}
              <Field data-invalid={amountError ? true : undefined}>
                <FieldLabelWithInfo htmlFor="refundAmount" help={refundHelp.amount}>
                  {t('invoices.refund.amount')}
                </FieldLabelWithInfo>
                <Input
                  id="refundAmount"
                  type="number"
                  min="0"
                  max={selected ? selected.remainingPaise / 100 : undefined}
                  step="0.01"
                  value={amount}
                  disabled={!selected}
                  onChange={(e) => {
                    setAmount(e.target.value);
                    setAmountError(null);
                  }}
                />
                {selected && (
                  <p className="text-xs text-muted-foreground">
                    {t('invoices.refund.remaining', {
                      max: formatCurrency(selected.remainingPaise / 100),
                    })}
                  </p>
                )}
                {amountError && (
                  <FieldError data-testid={ids.refundAmountError}>{amountError}</FieldError>
                )}
              </Field>
              <Field>
                <FieldLabelWithInfo htmlFor="refundReason" help={refundHelp.reason}>
                  {t('invoices.refund.reason')}
                </FieldLabelWithInfo>
                <Input
                  id="refundReason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder={t('invoices.refund.reasonPlaceholder')}
                />
              </Field>
            </FieldGroup>
            <DialogFooter className="mt-6">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t('invoices.refund.cancel')}
              </Button>
              <Button
                type="submit"
                variant="destructive"
                data-testid={ids.refundSubmit}
                disabled={isSubmitting || !selected || !amount}
              >
                {isSubmitting ? t('invoices.refund.processing') : t('invoices.refund.confirm')}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function paiseToRupees(paise: number): string {
  const whole = Math.trunc(paise / 100);
  const frac = String(paise % 100).padStart(2, '0');
  return frac === '00' ? String(whole) : `${whole}.${frac}`;
}

/** Exact decimal parse: no float multiplication, so 678.82 is 67882 paise. */
function rupeesToPaise(value: string): number | null {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0') || 0);
}
