'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { extractGraphQLError, gql, useQuery } from '@roviq/graphql';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@roviq/ui';
import { Money } from '@roviq/value-objects';
import { Copy, Loader2 } from 'lucide-react';
import { useLocale } from 'next-intl';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { useSubscriptionPlans } from '../plans/use-plans';
import { useAssignPlan } from './use-subscriptions';

const PROVIDERS = ['RAZORPAY', 'CASHFREE'] as const;

const ORGANIZATIONS_QUERY = gql`
  query OrganizationsForAssign {
    organizations {
      id
      name
    }
  }
`;

interface OrganizationsData {
  organizations: { id: string; name: string }[];
}

interface AssignPlanDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  t: (key: string) => string;
}

export function AssignPlanDialog({ open, onOpenChange, t }: AssignPlanDialogProps) {
  const locale = useLocale();
  const { plans } = useSubscriptionPlans();
  const { data: orgsData } = useQuery<OrganizationsData>(ORGANIZATIONS_QUERY);
  const [assignPlan] = useAssignPlan();
  const [checkoutUrl, setCheckoutUrl] = React.useState<string | null>(null);

  const activePlans = plans.filter((p) => p.isActive);
  const organizations = orgsData?.organizations ?? [];

  const assignSchema = z.object({
    organizationId: z.string().min(1, t('subscriptions.assign.orgRequired')),
    planId: z.string().min(1, t('subscriptions.assign.planRequired')),
    provider: z.enum(PROVIDERS, {
      message: t('subscriptions.assign.providerRequired'),
    }),
    customerEmail: z.string().email(t('subscriptions.assign.emailRequired')),
    customerPhone: z.string().min(1, t('subscriptions.assign.phoneRequired')),
  });

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
      organizationId: '',
      planId: '',
      provider: undefined,
      customerEmail: '',
      customerPhone: '',
    },
  });

  React.useEffect(() => {
    if (open) {
      reset({
        organizationId: '',
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
            organizationId: values.organizationId,
            planId: values.planId,
            provider: values.provider,
            customerEmail: values.customerEmail,
            customerPhone: values.customerPhone,
          },
        },
      });
      const url = data?.assignPlanToOrganization?.checkoutUrl;
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

  const organizationId = watch('organizationId');
  const planId = watch('planId');
  const provider = watch('provider');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{t('subscriptions.assign.title')}</DialogTitle>
          <DialogDescription>{t('subscriptions.assign.title')}</DialogDescription>
        </DialogHeader>

        {checkoutUrl ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t('subscriptions.assign.checkoutUrl')}</Label>
              <div className="flex gap-2">
                <Input value={checkoutUrl} readOnly className="font-mono text-xs" />
                <Button variant="outline" size="icon" onClick={copyUrl}>
                  <Copy className="size-4" />
                </Button>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {t('subscriptions.assign.close')}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <Label>{t('subscriptions.assign.organization')}</Label>
              <Select value={organizationId} onValueChange={(v) => setValue('organizationId', v)}>
                <SelectTrigger>
                  <SelectValue placeholder={t('subscriptions.assign.selectOrganization')} />
                </SelectTrigger>
                <SelectContent>
                  {organizations.map((org) => (
                    <SelectItem key={org.id} value={org.id}>
                      {org.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.organizationId && (
                <p className="text-sm text-destructive">{errors.organizationId.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label>{t('subscriptions.assign.plan')}</Label>
              <Select value={planId} onValueChange={(v) => setValue('planId', v)}>
                <SelectTrigger>
                  <SelectValue placeholder={t('subscriptions.assign.selectPlan')} />
                </SelectTrigger>
                <SelectContent>
                  {activePlans.map((plan) => (
                    <SelectItem key={plan.id} value={plan.id}>
                      <div className="flex items-center gap-2">
                        <span>{plan.name}</span>
                        <span className="text-muted-foreground">
                          {plan.amount === 0
                            ? t('subscriptions.assign.free')
                            : `${Money.create(plan.amount, plan.currency).format(locale)} / ${t(`plans.intervals.${plan.billingInterval}`)}`}
                        </span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.planId && <p className="text-sm text-destructive">{errors.planId.message}</p>}
            </div>

            <div className="space-y-2">
              <Label>{t('subscriptions.assign.provider')}</Label>
              <Select
                value={provider}
                onValueChange={(v) => setValue('provider', v as AssignFormValues['provider'])}
              >
                <SelectTrigger>
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
              {errors.provider && (
                <p className="text-sm text-destructive">{errors.provider.message}</p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="customerEmail">{t('subscriptions.assign.customerEmail')}</Label>
                <Input
                  id="customerEmail"
                  type="email"
                  placeholder={t('subscriptions.assign.emailPlaceholder')}
                  {...register('customerEmail')}
                />
                {errors.customerEmail && (
                  <p className="text-sm text-destructive">{errors.customerEmail.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="customerPhone">{t('subscriptions.assign.customerPhone')}</Label>
                <Input
                  id="customerPhone"
                  type="tel"
                  placeholder={t('subscriptions.assign.phonePlaceholder')}
                  {...register('customerPhone')}
                />
                {errors.customerPhone && (
                  <p className="text-sm text-destructive">{errors.customerPhone.message}</p>
                )}
              </div>
            </div>

            <DialogFooter>
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
