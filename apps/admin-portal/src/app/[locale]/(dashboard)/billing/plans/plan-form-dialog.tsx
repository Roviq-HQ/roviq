'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import type { FeatureLimits } from '@roviq/ee-billing-types';
import { extractGraphQLError } from '@roviq/graphql';
import {
  Button,
  Checkbox,
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
import { Loader2 } from 'lucide-react';
import * as React from 'react';
import { type Resolver, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { type SubscriptionPlanNode, useCreatePlan, useUpdatePlan } from './use-plans';

const BILLING_INTERVALS = ['MONTHLY', 'QUARTERLY', 'YEARLY'] as const;

interface PlanFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plan?: SubscriptionPlanNode | null;
  t: (key: string) => string;
}

export function PlanFormDialog({ open, onOpenChange, plan, t }: PlanFormDialogProps) {
  const isEditing = !!plan;
  const [createPlan] = useCreatePlan();
  const [updatePlan] = useUpdatePlan();

  const planSchema = z.object({
    name: z.string().min(1, t('plans.form.nameRequired')),
    description: z.string().optional(),
    amount: z.number().nonnegative(t('plans.form.amountRequired')),
    billingInterval: z.enum(BILLING_INTERVALS),
    maxUsers: z.number().int().nonnegative().optional(),
    maxSections: z.number().int().nonnegative().optional(),
    isActive: z.boolean().optional(),
  });

  type PlanFormValues = z.infer<typeof planSchema>;

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<PlanFormValues>({
    resolver: zodResolver(planSchema) as Resolver<PlanFormValues>,
    defaultValues: {
      name: plan?.name ?? '',
      description: plan?.description ?? '',
      amount: plan ? plan.amount / 100 : 0,
      billingInterval: plan?.billingInterval ?? 'MONTHLY',
      maxUsers: plan?.featureLimits?.maxUsers ?? undefined,
      maxSections: plan?.featureLimits?.maxSections ?? undefined,
      isActive: plan?.isActive ?? true,
    },
  });

  React.useEffect(() => {
    if (open) {
      reset({
        name: plan?.name ?? '',
        description: plan?.description ?? '',
        amount: plan ? plan.amount / 100 : 0,
        billingInterval: plan?.billingInterval ?? 'MONTHLY',
        maxUsers: plan?.featureLimits?.maxUsers ?? undefined,
        maxSections: plan?.featureLimits?.maxSections ?? undefined,
        isActive: plan?.isActive ?? true,
      });
    }
  }, [open, plan, reset]);

  const onSubmit = async (values: PlanFormValues) => {
    const featureLimits: FeatureLimits = {};
    if (values.maxUsers != null) featureLimits.maxUsers = values.maxUsers;
    if (values.maxSections != null) featureLimits.maxSections = values.maxSections;

    try {
      if (isEditing && plan) {
        await updatePlan({
          variables: {
            id: plan.id,
            input: {
              name: values.name,
              description: values.description || undefined,
              amount: Math.round(values.amount * 100),
              billingInterval: values.billingInterval,
              featureLimits,
              isActive: values.isActive,
            },
          },
        });
        toast.success(t('plans.form.updateSuccess'));
      } else {
        await createPlan({
          variables: {
            input: {
              name: values.name,
              description: values.description || undefined,
              amount: Math.round(values.amount * 100),
              billingInterval: values.billingInterval,
              featureLimits,
            },
          },
        });
        toast.success(t('plans.form.createSuccess'));
      }
      onOpenChange(false);
    } catch (err) {
      const fallback = isEditing ? t('plans.form.updateError') : t('plans.form.createError');
      toast.error(fallback, { description: extractGraphQLError(err, fallback) });
    }
  };

  const billingInterval = watch('billingInterval');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{isEditing ? t('plans.editPlan') : t('plans.createPlan')}</DialogTitle>
          <DialogDescription>
            {isEditing ? t('plans.editPlan') : t('plans.createPlan')}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">{t('plans.form.name')}</Label>
            <Input id="name" placeholder={t('plans.form.namePlaceholder')} {...register('name')} />
            {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">{t('plans.form.description')}</Label>
            <Input
              id="description"
              placeholder={t('plans.form.descriptionPlaceholder')}
              {...register('description')}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="amount">{t('plans.form.amount')}</Label>
              <Input
                id="amount"
                type="number"
                min="0"
                step="0.01"
                placeholder={t('plans.form.amountPlaceholder')}
                {...register('amount', { valueAsNumber: true })}
              />
              {errors.amount && <p className="text-sm text-destructive">{errors.amount.message}</p>}
            </div>

            <div className="space-y-2">
              <Label>{t('plans.form.interval')}</Label>
              <Select
                value={billingInterval}
                onValueChange={(v) =>
                  setValue('billingInterval', v as PlanFormValues['billingInterval'])
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder={t('plans.form.selectInterval')} />
                </SelectTrigger>
                <SelectContent>
                  {BILLING_INTERVALS.map((interval) => (
                    <SelectItem key={interval} value={interval}>
                      {t(`plans.intervals.${interval}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="maxUsers">{t('plans.form.maxUsers')}</Label>
              <Input
                id="maxUsers"
                type="number"
                min="0"
                {...register('maxUsers', { valueAsNumber: true })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="maxSections">{t('plans.form.maxSections')}</Label>
              <Input
                id="maxSections"
                type="number"
                min="0"
                {...register('maxSections', { valueAsNumber: true })}
              />
            </div>
          </div>

          {isEditing && (
            <div className="flex items-center gap-2">
              <Checkbox
                id="isActive"
                checked={watch('isActive')}
                onCheckedChange={(checked) => setValue('isActive', !!checked)}
              />
              <Label htmlFor="isActive">{t('plans.form.isActive')}</Label>
            </div>
          )}

          <DialogFooter>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {t('plans.form.saving')}
                </>
              ) : (
                t('plans.form.save')
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
