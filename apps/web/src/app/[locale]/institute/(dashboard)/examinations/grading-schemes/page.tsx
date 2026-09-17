'use client';

import { extractGraphQLError } from '@roviq/graphql';
import { useI18nField } from '@roviq/i18n';
import {
  Badge,
  Button,
  Can,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Field,
  FieldLabel,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { ListChecks, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import { toast } from 'sonner';
import {
  type GradeBandInput,
  type GradingSchemeKind,
  useCreateGradingScheme,
  useDeleteGradingScheme,
  useGradingSchemes,
} from '../use-examinations';

const { instituteExaminations: ex } = testIds;

/** Default CBSE-style scholastic bands offered when creating a scheme. */
const DEFAULT_BANDS: GradeBandInput[] = [
  { grade: 'A1', minPercent: 91, maxPercent: 100, gradePoint: 10, isPassing: true },
  { grade: 'A2', minPercent: 81, maxPercent: 90, gradePoint: 9, isPassing: true },
  { grade: 'B1', minPercent: 71, maxPercent: 80, gradePoint: 8, isPassing: true },
  { grade: 'B2', minPercent: 61, maxPercent: 70, gradePoint: 7, isPassing: true },
  { grade: 'C1', minPercent: 51, maxPercent: 60, gradePoint: 6, isPassing: true },
  { grade: 'C2', minPercent: 41, maxPercent: 50, gradePoint: 5, isPassing: true },
  { grade: 'D', minPercent: 33, maxPercent: 40, gradePoint: 4, isPassing: true },
  { grade: 'E', minPercent: 0, maxPercent: 32, gradePoint: 0, isPassing: false },
];

export default function GradingSchemesPage() {
  const t = useTranslations('examinations');
  const resolveI18n = useI18nField();
  const { schemes, loading } = useGradingSchemes();
  const { deleteScheme } = useDeleteGradingScheme();
  const [createOpen, setCreateOpen] = React.useState(false);

  const handleDelete = async (id: string) => {
    try {
      await deleteScheme(id);
      toast.success(t('grading.deleted'));
    } catch (err) {
      toast.error(extractGraphQLError(err, t('grading.inUse')));
    }
  };

  return (
    <Can I="read" a="GradingScheme" passThrough>
      {(allowed: boolean) =>
        allowed ? (
          <div className="space-y-6" data-testid={ex.gradingPage}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h1 className="text-2xl font-semibold tracking-tight" data-testid={ex.gradingTitle}>
                  {t('grading.title')}
                </h1>
                <p className="text-sm text-muted-foreground">{t('grading.description')}</p>
              </div>
              <Can I="manage" a="GradingScheme">
                <Button
                  className="gap-2"
                  onClick={() => setCreateOpen(true)}
                  data-testid={ex.gradingCreateBtn}
                >
                  <Plus className="size-4" /> {t('grading.create')}
                </Button>
              </Can>
            </div>

            {loading ? (
              <SchemesSkeleton />
            ) : schemes.length === 0 ? (
              <Empty data-testid={ex.gradingEmpty}>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <ListChecks aria-hidden="true" />
                  </EmptyMedia>
                  <EmptyTitle>{t('emptyStates.noSchemesTitle')}</EmptyTitle>
                  <EmptyDescription>{t('emptyStates.noSchemesDescription')}</EmptyDescription>
                </EmptyHeader>
                <Can I="manage" a="GradingScheme">
                  <EmptyContent>
                    <Button
                      className="gap-2"
                      onClick={() => setCreateOpen(true)}
                      data-testid={ex.gradingEmptyCreateBtn}
                    >
                      <Plus className="size-4" /> {t('grading.create')}
                    </Button>
                  </EmptyContent>
                </Can>
              </Empty>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {schemes.map((s) => (
                  <div
                    key={s.id}
                    className="rounded-md border p-4 space-y-2"
                    data-testid={ex.gradingRow(s.id)}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-medium">{resolveI18n(s.name)}</p>
                        <p className="text-xs text-muted-foreground">
                          {t(`grading.kinds.${s.kind}`)}
                          {s.board ? ` · ${s.board}` : ''}
                        </p>
                      </div>
                      {s.isDefault && <Badge variant="secondary">{t('grading.isDefault')}</Badge>}
                    </div>
                    <Can I="manage" a="GradingScheme">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => handleDelete(s.id)}
                        aria-label={t('delete')}
                        title={t('delete')}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </Can>
                  </div>
                ))}
              </div>
            )}

            {createOpen && <CreateSchemeDialog open={createOpen} onOpenChange={setCreateOpen} />}
          </div>
        ) : (
          <AccessDenied />
        )
      }
    </Can>
  );
}

function CreateSchemeDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const t = useTranslations('examinations');
  const { createScheme, loading } = useCreateGradingScheme();
  const [name, setName] = React.useState('');
  const [kind, setKind] = React.useState<GradingSchemeKind>('SCHOLASTIC');
  const [board, setBoard] = React.useState('');
  const [isDefault, setIsDefault] = React.useState(false);
  const [bands, setBands] = React.useState<GradeBandInput[]>(DEFAULT_BANDS);

  const isScholastic = kind === 'SCHOLASTIC';
  const updateBand = (i: number, patch: Partial<GradeBandInput>) =>
    setBands((prev) => prev.map((b, idx) => (idx === i ? { ...b, ...patch } : b)));
  const addBand = () =>
    setBands((prev) => [
      ...prev,
      { grade: '', minPercent: null, maxPercent: null, gradePoint: null, isPassing: true },
    ]);
  const removeBand = (i: number) => setBands((prev) => prev.filter((_, idx) => idx !== i));

  const handleSubmit = async () => {
    if (!name.trim()) return;
    try {
      await createScheme({
        name: { en: name.trim() },
        kind,
        board: board || null,
        isDefault,
        bands: bands.map((b, i) => ({ ...b, sequence: i })),
      });
      toast.success(t('grading.created'));
      onOpenChange(false);
    } catch (err) {
      toast.error(extractGraphQLError(err, t('errors.GRADING_SCHEME_INVALID_BANDS')));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('grading.create')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field>
              <FieldLabel htmlFor="gs-name">{t('name')}</FieldLabel>
              <Input
                id="gs-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                data-testid={ex.gradingNameInput}
              />
            </Field>
            <Field>
              <FieldLabel>{t('grading.kind')}</FieldLabel>
              <Select value={kind} onValueChange={(v) => setKind(v as GradingSchemeKind)}>
                <SelectTrigger data-testid={ex.gradingKindSelect} aria-label={t('grading.kind')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="SCHOLASTIC">{t('grading.kinds.SCHOLASTIC')}</SelectItem>
                  <SelectItem value="CO_SCHOLASTIC">{t('grading.kinds.CO_SCHOLASTIC')}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field>
              <FieldLabel htmlFor="gs-board">{t('grading.board')}</FieldLabel>
              <Input
                id="gs-board"
                value={board}
                placeholder="CBSE"
                onChange={(e) => setBoard(e.target.value)}
              />
            </Field>
            <label className="flex items-end gap-2 pb-2 text-sm">
              <input
                type="checkbox"
                checked={isDefault}
                onChange={(e) => setIsDefault(e.target.checked)}
              />
              {t('grading.isDefault')}
            </label>
          </div>

          <div className="flex items-center justify-between">
            <FieldLabel>{t('grading.bands')}</FieldLabel>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={addBand}>
              <Plus className="size-3" /> {t('grading.addBand')}
            </Button>
          </div>
          <div className="space-y-2">
            {bands.map((b, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: positional band row.
              <div key={i} className="flex items-center gap-2">
                <Input
                  className="h-8 w-20"
                  placeholder={t('grading.grade')}
                  value={b.grade}
                  onChange={(e) => updateBand(i, { grade: e.target.value })}
                />
                {isScholastic && (
                  <>
                    <Input
                      className="h-8 w-20"
                      type="number"
                      placeholder={t('grading.minPercent')}
                      value={b.minPercent ?? ''}
                      onChange={(e) =>
                        updateBand(i, {
                          minPercent: e.target.value === '' ? null : Number(e.target.value),
                        })
                      }
                    />
                    <Input
                      className="h-8 w-20"
                      type="number"
                      placeholder={t('grading.maxPercent')}
                      value={b.maxPercent ?? ''}
                      onChange={(e) =>
                        updateBand(i, {
                          maxPercent: e.target.value === '' ? null : Number(e.target.value),
                        })
                      }
                    />
                    <Input
                      className="h-8 w-24"
                      type="number"
                      placeholder={t('grading.gradePoint')}
                      value={b.gradePoint ?? ''}
                      onChange={(e) =>
                        updateBand(i, {
                          gradePoint: e.target.value === '' ? null : Number(e.target.value),
                        })
                      }
                    />
                  </>
                )}
                <label className="flex items-center gap-1 text-xs">
                  <input
                    type="checkbox"
                    checked={b.isPassing ?? true}
                    onChange={(e) => updateBand(i, { isPassing: e.target.checked })}
                  />
                  {t('grading.isPassing')}
                </label>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => removeBand(i)}
                  aria-label={t('delete')}
                  title={t('delete')}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('cancel')}
          </Button>
          <Button
            disabled={loading || !name.trim()}
            onClick={handleSubmit}
            data-testid={ex.gradingSubmitBtn}
          >
            {loading ? t('saving') : t('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SchemesSkeleton() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid={ex.gradingSkeleton}>
      {Array.from({ length: 6 }).map((_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton cards
        <Skeleton key={i} className="h-24 w-full" />
      ))}
    </div>
  );
}

function AccessDenied() {
  const t = useTranslations('examinations');
  return (
    <div className="flex items-center justify-center min-h-[400px]">
      <p className="text-muted-foreground">{t('accessDenied')}</p>
    </div>
  );
}
