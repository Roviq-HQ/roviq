'use client';

import { useFormatDate } from '@roviq/i18n';
import {
  Button,
  Calendar,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@roviq/ui';
import { CalendarIcon, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { useCreateAcademicYear } from './use-academic-years';

interface CreateYearForm {
  label: string;
  startDate: string;
  endDate: string;
  terms: Array<{ label: string; startDate: string; endDate: string }>;
}

export function CreateYearDialog() {
  const t = useTranslations('academicYears');
  const { format } = useFormatDate();
  const { createYear, loading } = useCreateAcademicYear();
  const [open, setOpen] = useState(false);

  const form = useForm<CreateYearForm>({
    defaultValues: {
      label: '',
      startDate: '',
      endDate: '',
      terms: [],
    },
  });

  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'terms' });

  const onSubmit = async (data: CreateYearForm) => {
    if (data.startDate >= data.endDate) {
      form.setError('endDate', { message: t('errors.INVALID_DATE_RANGE') });
      return;
    }

    try {
      await createYear({
        label: data.label,
        startDate: data.startDate,
        endDate: data.endDate,
        termStructure: data.terms.length > 0 ? data.terms : undefined,
      });
      toast.success(t('created'));
      setOpen(false);
      form.reset();
    } catch (err) {
      const message = (err as Error).message;
      if (message.includes('overlap')) {
        toast.error(t('errors.ACADEMIC_YEAR_OVERLAP'));
      } else if (message.includes('date')) {
        form.setError('endDate', { message: t('errors.INVALID_DATE_RANGE') });
      } else {
        toast.error(message);
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-2">
          <Plus className="size-4" />
          {t('newYear')}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('newYear')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
          <FieldGroup>
            <Field>
              <FieldLabel>{t('label')}</FieldLabel>
              <Input
                placeholder={t('labelPlaceholder')}
                {...form.register('label', { required: true })}
              />
              {form.formState.errors.label && (
                <FieldError>{form.formState.errors.label.message}</FieldError>
              )}
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field>
                <FieldLabel>{t('startDate')}</FieldLabel>
                <DatePickerField
                  value={form.watch('startDate')}
                  onChange={(v) => form.setValue('startDate', v)}
                  format={format}
                />
                {form.formState.errors.startDate && (
                  <FieldError>{form.formState.errors.startDate.message}</FieldError>
                )}
              </Field>

              <Field>
                <FieldLabel>{t('endDate')}</FieldLabel>
                <DatePickerField
                  value={form.watch('endDate')}
                  onChange={(v) => form.setValue('endDate', v)}
                  format={format}
                />
                {form.formState.errors.endDate && (
                  <FieldError>{form.formState.errors.endDate.message}</FieldError>
                )}
              </Field>
            </div>
          </FieldGroup>

          {/* Term Structure */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <FieldLabel className="text-sm font-medium">{t('termStructure')}</FieldLabel>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => append({ label: '', startDate: '', endDate: '' })}
                className="gap-1.5 text-xs"
              >
                <Plus className="size-3" />
                {t('addTerm')}
              </Button>
            </div>

            {fields.map((field, index) => (
              <div
                key={field.id}
                className="rounded-lg border border-border/60 bg-muted/30 p-3 space-y-2"
              >
                <div className="flex items-center gap-2">
                  <Input
                    placeholder={t('termLabelPlaceholder')}
                    className="flex-1 h-8 text-sm"
                    {...form.register(`terms.${index}.label`, { required: true })}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => remove(index)}
                    className="size-8 p-0 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <span className="text-[11px] text-muted-foreground">{t('termStart')}</span>
                    <Input
                      type="date"
                      className="h-8 text-sm"
                      {...form.register(`terms.${index}.startDate`, { required: true })}
                    />
                  </div>
                  <div>
                    <span className="text-[11px] text-muted-foreground">{t('termEnd')}</span>
                    <Input
                      type="date"
                      className="h-8 text-sm"
                      {...form.register(`terms.${index}.endDate`, { required: true })}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? t('creating') : t('createYear')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DatePickerField({
  value,
  onChange,
  format,
}: {
  value: string;
  onChange: (v: string) => void;
  format: (date: Date, pattern: string) => string;
}) {
  const selected = value ? new Date(value) : undefined;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" className="w-full justify-start text-start font-normal h-9">
          <CalendarIcon className="me-2 size-4 text-muted-foreground" />
          {selected ? (
            format(selected, 'dd/MM/yyyy')
          ) : (
            <span className="text-muted-foreground">DD/MM/YYYY</span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={selected}
          onSelect={(date) => {
            if (date) {
              onChange(date.toISOString().split('T')[0]);
            }
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
