'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useAuth } from '@roviq/auth';
import { Money } from '@roviq/domain';
import { extractGraphQLError, gql, useQuery } from '@roviq/graphql';
import { useI18nField } from '@roviq/i18n';
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
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@roviq/ui';
import { Copy, Loader2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { useSubscriptionPlans } from '../plans/use-plans';

type InstitutesForAssignQuery = {
  billingInstitutes: Array<{ id: string; name: string }>;
};

import { useAssignPlan } from './use-subscriptions';

const PROVIDERS = ['RAZORPAY', 'CASHFREE'] as const;

const INSTITUTES_QUERY = gql`
  query InstitutesForAssign {
    billingInstitutes {
      id
      name
    }
  }
`;

interface AssignPlanDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AssignPlanDialog({ open, onOpenChange }: AssignPlanDialogProps) {
  const t = useTranslations('billing');
  const { user } = useAuth();
  const locale = useLocale();
  const ti = useI18nField();
  const { plans } = useSubscriptionPlans();
  const { data: institutesData } = useQuery<InstitutesForAssignQuery>(INSTITUTES_QUERY);
  const [assignPlan] = useAssignPlan();
  const [checkoutUrl, setCheckoutUrl] = React.useState<string | null>(null);

  const activePlans = plans.filter((p) => p.status === 'ACTIVE');
  const institutes = institutesData?.billingInstitutes ?? [];

  const assignSchema = React.useMemo(
    () =>
      z.object({
        tenantId: z.string().min(1, t('subscriptions.assign.instituteRequired')),
        planId: z.string().min(1, t('subscriptions.assign.planRequired')),
        provider: z.enum(PROVIDERS, {
          message: t('subscriptions.assign.providerRequired'),
        }),
        customerEmail: z.string().email(t('subscriptions.assign.emailRequired')),
        customerPhone: z.string().min(1, t('subscriptions.assign.phoneRequired')),
      }),
    [t],
  );

  type AssignFormValues = z.infer<typeof assignSchema>;

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<AssignFormValues>({
    resolver: zodResolver(assignSchema),
    defaultValues: {
      tenantId: '',
      planId: '',
      provider: undefined,
      customerEmail: '',
      customerPhone: '',
    },
  });

  React.useEffect(() => {
    if (open) {
      reset({
        tenantId: '',
        planId: '',
        provider: undefined,
        customerEmail: '',
        customerPhone: '',
      });
      setCheckoutUrl(null);
    }
  }, [open, reset]);

  const onSubmit = async (values: AssignFormValues) => {
    try {
      const { data } = await assignPlan({
        variables: {
          input: {
            tenantId: values.tenantId,
            resellerId: user?.resellerId ?? '',
            planId: values.planId,
            provider: values.provider,
            customerEmail: values.customerEmail,
            customerPhone: values.customerPhone,
          },
        },
      });
      const url = data?.assignPlanToInstitute?.checkoutUrl;
      if (url) {
        setCheckoutUrl(url);
      } else {
        onOpenChange(false);
      }
      toast.success(t('subscriptions.assign.success'));
    } catch (err) {
      toast.error(t('subscriptions.assign.error'), {
        description: extractGraphQLError(err, t('subscriptions.assign.error')),
      });
    }
  };

  const copyUrl = () => {
    if (checkoutUrl) {
      navigator.clipboard.writeText(checkoutUrl);
      toast.success(t('subscriptions.assign.copied'));
    }
  };

  const tenantId = watch('tenantId');
  const planId = watch('planId');
  const provider = watch('provider');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{t('subscriptions.assign.title')}</DialogTitle>
          <DialogDescription>{t('subscriptions.assign.description')}</DialogDescription>
        </DialogHeader>

        {checkoutUrl ? (
          <div className="space-y-4">
            <Field>
              <FieldLabel>{t('subscriptions.assign.checkoutUrl')}</FieldLabel>
              <div className="flex gap-2">
                <Input value={checkoutUrl} readOnly className="font-mono text-xs" />
                <Button variant="outline" size="icon" onClick={copyUrl}>
                  <Copy className="size-4" />
                </Button>
              </div>
            </Field>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {t('subscriptions.assign.close')}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)}>
            <FieldGroup>
              <Field data-invalid={!!errors.tenantId}>
                <FieldLabel>{t('subscriptions.assign.institute')}</FieldLabel>
                <Select value={tenantId} onValueChange={(v) => setValue('tenantId', v)}>
                  <SelectTrigger aria-invalid={!!errors.tenantId}>
                    <SelectValue placeholder={t('subscriptions.assign.selectInstitute')} />
                  </SelectTrigger>
                  <SelectContent>
                    {institutes.map((inst) => (
                      <SelectItem key={inst.id} value={inst.id}>
                        {ti(inst.name)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.tenantId && <FieldError errors={[errors.tenantId]} />}
              </Field>

              <Field data-invalid={!!errors.planId}>
                <FieldLabel>{t('subscriptions.assign.plan')}</FieldLabel>
                <Select value={planId} onValueChange={(v) => setValue('planId', v)}>
                  <SelectTrigger aria-invalid={!!errors.planId}>
                    <SelectValue placeholder={t('subscriptions.assign.selectPlan')} />
                  </SelectTrigger>
                  <SelectContent>
                    {activePlans.map((plan) => (
                      <SelectItem key={plan.id} value={plan.id}>
                        <div className="flex items-center gap-2">
                          <span>{ti(plan.name)}</span>
                          <span className="text-muted-foreground">
                            {Number(plan.amount) === 0
                              ? t('subscriptions.assign.free')
                              : `${Money.tryCreate(Number(plan.amount), plan.currency)?.format(locale) ?? '—'} / ${t(`plans.intervals.${plan.interval}`)}`}
                          </span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.planId && <FieldError errors={[errors.planId]} />}
              </Field>

              <Field data-invalid={!!errors.provider}>
                <FieldLabel>{t('subscriptions.assign.provider')}</FieldLabel>
                <Select
                  value={provider}
                  onValueChange={(v) => setValue('provider', v as AssignFormValues['provider'])}
                >
                  <SelectTrigger aria-invalid={!!errors.provider}>
                    <SelectValue placeholder={t('subscriptions.assign.selectProvider')} />
                  </SelectTrigger>
                  <SelectContent>
                    {PROVIDERS.map((p) => (
                      <SelectItem key={p} value={p}>
                        {t(`subscriptions.assign.providers.${p}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.provider && <FieldError errors={[errors.provider]} />}
              </Field>

              <div className="grid grid-cols-2 gap-4">
                <Field data-invalid={!!errors.customerEmail}>
                  <FieldLabel htmlFor="customerEmail">
                    {t('subscriptions.assign.customerEmail')}
                  </FieldLabel>
                  <Input
                    id="customerEmail"
                    type="email"
                    placeholder={t('subscriptions.assign.emailPlaceholder')}
                    aria-invalid={!!errors.customerEmail}
                    {...register('customerEmail')}
                  />
                  {errors.customerEmail && <FieldError errors={[errors.customerEmail]} />}
                </Field>
                <Field data-invalid={!!errors.customerPhone}>
                  <FieldLabel htmlFor="customerPhone">
                    {t('subscriptions.assign.customerPhone')}
                  </FieldLabel>
                  <Input
                    id="customerPhone"
                    type="tel"
                    placeholder={t('subscriptions.assign.phonePlaceholder')}
                    aria-invalid={!!errors.customerPhone}
                    {...register('customerPhone')}
                  />
                  {errors.customerPhone && <FieldError errors={[errors.customerPhone]} />}
                </Field>
              </div>
            </FieldGroup>

            <DialogFooter className="mt-6">
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    {t('subscriptions.assign.assigning')}
                  </>
                ) : (
                  t('subscriptions.assign.assign')
                )}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
