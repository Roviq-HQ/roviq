'use client';

import { extractGraphQLError } from '@roviq/graphql';
import { Link, useI18nField } from '@roviq/i18n';
import {
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import {
  AcademicYearSelector,
  useSelectedAcademicYear,
} from '@web/components/pickers/academic-year-picker';
import { CalendarClock, GraduationCap, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import { toast } from 'sonner';
import { ExamStatusBadge } from './status-badge';
import {
  EXAM_TYPES,
  type ExamType,
  useCreateExam,
  useDeleteExam,
  useExams,
  useExamTerms,
  useGradingSchemes,
} from './use-examinations';

const { instituteExaminations: ex } = testIds;

export default function ExaminationsPage() {
  const t = useTranslations('examinations');
  const { yearId } = useSelectedAcademicYear();
  const resolveI18n = useI18nField();
  const { exams, loading } = useExams(yearId);
  const { deleteExam } = useDeleteExam();
  const [createOpen, setCreateOpen] = React.useState(false);

  const handleDelete = async (id: string) => {
    if (!window.confirm(t('deleteConfirm'))) return;
    try {
      await deleteExam(id);
      toast.success(t('deleted'));
    } catch (err) {
      toast.error(extractGraphQLError(err, t('errors.generic')));
    }
  };

  return (
    <Can I="read" a="Exam" passThrough>
      {(allowed: boolean) =>
        allowed ? (
          <div className="space-y-6" data-testid={ex.page}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h1 className="text-2xl font-semibold tracking-tight" data-testid={ex.title}>
                  {t('title')}
                </h1>
                <p className="text-sm text-muted-foreground">{t('description')}</p>
              </div>
              <div className="flex items-center gap-3">
                <AcademicYearSelector />
                <Can I="create" a="Exam">
                  <Button
                    className="gap-2"
                    disabled={!yearId}
                    onClick={() => setCreateOpen(true)}
                    data-testid={ex.createButton}
                  >
                    <Plus className="size-4" /> {t('create')}
                  </Button>
                </Can>
              </div>
            </div>

            {!yearId ? (
              <NoYearState />
            ) : loading ? (
              <ListSkeleton />
            ) : exams.length === 0 ? (
              <NoExamsState onCreate={() => setCreateOpen(true)} />
            ) : (
              <div className="overflow-x-auto rounded-md border" data-testid={ex.table}>
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead>{t('name')}</TableHead>
                      <TableHead>{t('type')}</TableHead>
                      <TableHead>{t('status')}</TableHead>
                      <TableHead className="w-[1%]" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {exams.map((exam) => (
                      <TableRow key={exam.id} data-testid={ex.row(exam.id)}>
                        <TableCell>
                          <Link
                            href={`/institute/examinations/${exam.id}`}
                            className="font-medium hover:underline"
                            data-testid={ex.rowLink(exam.id)}
                          >
                            {resolveI18n(exam.name)}
                          </Link>
                        </TableCell>
                        <TableCell>{t(`examTypes.${exam.type}`)}</TableCell>
                        <TableCell>
                          <ExamStatusBadge status={exam.status} testId={ex.rowStatus(exam.id)} />
                        </TableCell>
                        <TableCell className="text-end">
                          <Can I="delete" a="Exam">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-muted-foreground hover:text-destructive"
                              title={t('deleteConfirm')}
                              aria-label={t('delete')}
                              onClick={() => handleDelete(exam.id)}
                              data-testid={ex.deleteBtn(exam.id)}
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </Can>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            {createOpen && yearId && (
              <CreateExamDialog
                academicYearId={yearId}
                open={createOpen}
                onOpenChange={setCreateOpen}
              />
            )}
          </div>
        ) : (
          <AccessDenied />
        )
      }
    </Can>
  );
}

function CreateExamDialog({
  academicYearId,
  open,
  onOpenChange,
}: {
  academicYearId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('examinations');
  const resolveI18n = useI18nField();
  const { createExam, loading } = useCreateExam();
  const { terms } = useExamTerms(academicYearId);
  const { schemes } = useGradingSchemes('SCHOLASTIC');

  const [name, setName] = React.useState('');
  const [type, setType] = React.useState<ExamType>('MID_TERM');
  const [termId, setTermId] = React.useState<string>('');
  const [schemeId, setSchemeId] = React.useState<string>('');
  const [startDate, setStartDate] = React.useState('');
  const [endDate, setEndDate] = React.useState('');
  const [weight, setWeight] = React.useState('100');

  const handleSubmit = async () => {
    if (!name.trim()) return;
    try {
      await createExam({
        academicYearId,
        name: { en: name.trim() },
        type,
        examTermId: termId || null,
        gradingSchemeId: schemeId || null,
        startDate: startDate || null,
        endDate: endDate || null,
        weightInTerm: Number(weight) || 100,
      });
      toast.success(t('created'));
      onOpenChange(false);
    } catch (err) {
      toast.error(extractGraphQLError(err, t('errors.generic')));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-testid={ex.wizard}>
        <DialogHeader>
          <DialogTitle>{t('create')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Field>
            <FieldLabel htmlFor="exam-name">{t('name')}</FieldLabel>
            <Input
              id="exam-name"
              value={name}
              placeholder={t('namePlaceholder')}
              onChange={(e) => setName(e.target.value)}
              data-testid={ex.wizardNameInput}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field>
              <FieldLabel>{t('type')}</FieldLabel>
              <Select value={type} onValueChange={(v) => setType(v as ExamType)}>
                <SelectTrigger data-testid={ex.wizardTypeSelect} aria-label={t('type')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EXAM_TYPES.map((ty) => (
                    <SelectItem key={ty} value={ty}>
                      {t(`examTypes.${ty}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel>{t('term')}</FieldLabel>
              <Select value={termId || undefined} onValueChange={setTermId}>
                <SelectTrigger data-testid={ex.wizardTermSelect} aria-label={t('term')}>
                  <SelectValue placeholder={t('noTerm')} />
                </SelectTrigger>
                <SelectContent>
                  {terms.map((term) => (
                    <SelectItem key={term.id} value={term.id}>
                      {resolveI18n(term.name)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Field>
            <FieldLabel>{t('gradingScheme')}</FieldLabel>
            <Select value={schemeId || undefined} onValueChange={setSchemeId}>
              <SelectTrigger data-testid={ex.wizardSchemeSelect} aria-label={t('gradingScheme')}>
                <SelectValue placeholder={t('defaultScheme')} />
              </SelectTrigger>
              <SelectContent>
                {schemes.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {resolveI18n(s.name)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field>
              <FieldLabel htmlFor="exam-start">{t('startDate')}</FieldLabel>
              <Input
                id="exam-start"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                data-testid={ex.wizardStartInput}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="exam-end">{t('endDate')}</FieldLabel>
              <Input
                id="exam-end"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                data-testid={ex.wizardEndInput}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="exam-weight">{t('weightInTerm')}</FieldLabel>
              <Input
                id="exam-weight"
                type="number"
                min={0}
                max={100}
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
                data-testid={ex.wizardWeightInput}
              />
            </Field>
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            data-testid={ex.wizardCancelBtn}
          >
            {t('cancel')}
          </Button>
          <Button
            disabled={loading || !name.trim()}
            onClick={handleSubmit}
            data-testid={ex.wizardSubmitBtn}
          >
            {loading ? t('saving') : t('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NoYearState() {
  const t = useTranslations('examinations');
  return (
    <Empty data-testid={ex.emptyState}>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <CalendarClock aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>{t('emptyStates.noYearTitle')}</EmptyTitle>
        <EmptyDescription>{t('emptyStates.noYearDescription')}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

function NoExamsState({ onCreate }: { onCreate: () => void }) {
  const t = useTranslations('examinations');
  return (
    <Empty data-testid={ex.emptyState}>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <GraduationCap aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>{t('emptyStates.noExamsTitle')}</EmptyTitle>
        <EmptyDescription>{t('emptyStates.noExamsDescription')}</EmptyDescription>
      </EmptyHeader>
      <Can I="create" a="Exam">
        <EmptyContent>
          <Button className="gap-2" onClick={onCreate} data-testid={ex.emptyCreateBtn}>
            <Plus className="size-4" /> {t('create')}
          </Button>
        </EmptyContent>
      </Can>
    </Empty>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-2 rounded-md border p-2" data-testid={ex.skeleton}>
      <Skeleton className="h-9 w-full" />
      {Array.from({ length: 6 }).map((_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton rows
        <Skeleton key={i} className="h-11 w-full" />
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
