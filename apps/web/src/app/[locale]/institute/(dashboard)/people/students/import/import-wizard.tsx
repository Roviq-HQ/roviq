'use client';

import {
  isStudentImportField,
  STUDENT_IMPORT_FIELD_VALUES,
  STUDENT_IMPORT_REQUIRED_FIELDS,
  type StudentImportField,
} from '@roviq/common-types';
import { extractGraphQLErrorCode } from '@roviq/graphql';
import { useI18nField } from '@roviq/i18n';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
} from '@roviq/ui';
import { cn } from '@roviq/ui/lib/utils';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { FileUpload } from '@web/components/file-upload/file-upload';
import { Check, Download, Info } from 'lucide-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import { toast } from 'sonner';
import {
  useAcademicYearsForStudents,
  useSectionsForStandard,
  useStandardsForYear,
} from '../use-students';
import {
  type ColumnMapping,
  canSkipColumn,
  downloadSampleCsv,
  type HeaderProblem,
  mappingProblems,
  readCsvHeaders,
  suggestMapping,
  toFieldMapping,
} from './student-import-csv';
import { useStartStudentImport } from './use-student-import';

const { instituteStudentImport: ids } = testIds;

const WIZARD_STEPS = ['file', 'target', 'columns'] as const;
type WizardStep = (typeof WIZARD_STEPS)[number];
const STEPS = [...WIZARD_STEPS, 'run'] as const;

// Select items need a non-empty value; this one stands for "leave the column out".
const SKIP = '__skip__';

export interface ImportTarget {
  academicYearId: string;
  standardId: string;
  sectionId: string;
}

interface PickedFile {
  fileId: string;
  headers: string[];
  problem: HeaderProblem | 'UNREADABLE' | null;
}

export function ImportWizard({
  onStarted,
}: {
  onStarted: (workflowId: string, target: ImportTarget) => void;
}) {
  const t = useTranslations('studentImport');
  const [step, setStep] = React.useState<WizardStep>('file');
  const [picked, setPicked] = React.useState<PickedFile | null>(null);
  const [uploading, setUploading] = React.useState(false);
  const [mapping, setMapping] = React.useState<ColumnMapping>({});
  const [target, setTarget] = React.useState<Partial<ImportTarget>>({});
  const [start, { loading: starting }] = useStartStudentImport();

  const onFiles = React.useCallback((fileIds: string[], files: File[]) => {
    const [fileId] = fileIds;
    const [file] = files;
    if (!fileId || !file) {
      setPicked(null);
      return;
    }
    readCsvHeaders(file).then(
      ({ headers, problem }) => {
        setPicked({ fileId, headers, problem });
        setMapping(suggestMapping(headers));
      },
      () => setPicked({ fileId, headers: [], problem: 'UNREADABLE' }),
    );
  }, []);

  const problems = mappingProblems(mapping);
  const mappingValid = problems.missing.length === 0 && problems.duplicates.length === 0;
  const targetComplete = Boolean(target.academicYearId && target.standardId && target.sectionId);

  const canContinue =
    step === 'file'
      ? Boolean(picked && !picked.problem) && !uploading
      : step === 'target'
        ? targetComplete
        : mappingValid;

  const submit = async () => {
    if (!picked || !target.academicYearId || !target.standardId || !target.sectionId) return;
    const chosen: ImportTarget = {
      academicYearId: target.academicYearId,
      standardId: target.standardId,
      sectionId: target.sectionId,
    };
    try {
      const { data } = await start({
        variables: {
          input: { fileId: picked.fileId, ...chosen, fieldMapping: toFieldMapping(mapping) },
        },
      });
      if (!data) throw new Error('No workflow id returned');
      onStarted(data.bulkCreateStudents.workflowId, chosen);
    } catch (error) {
      // An uploaded file is good for one import; a second start needs a fresh upload.
      const code = extractGraphQLErrorCode(error);
      toast.error(code === 'FILE_NOT_FOUND' ? t('fileUsed') : t('startFailed'));
    }
  };

  const index = WIZARD_STEPS.indexOf(step);
  const goBack = () => setStep(WIZARD_STEPS[index - 1] ?? 'file');
  const goNext = () =>
    step === 'columns' ? void submit() : setStep(WIZARD_STEPS[index + 1] ?? 'columns');

  return (
    <Card>
      <CardHeader>
        <StepIndicator current={index} />
      </CardHeader>
      <CardContent>
        {/* Kept mounted (hidden) so the uploaded file survives Back. */}
        <div hidden={step !== 'file'}>
          <FileStep picked={picked} onFiles={onFiles} onBusyChange={setUploading} />
        </div>
        {step === 'target' ? <TargetStep target={target} onChange={setTarget} /> : null}
        {step === 'columns' && picked ? (
          <ColumnsStep
            headers={picked.headers}
            mapping={mapping}
            onChange={setMapping}
            problems={problems}
          />
        ) : null}
      </CardContent>
      <CardFooter className="flex flex-wrap justify-between gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={goBack}
          disabled={index === 0 || starting}
          title={t('back')}
          data-testid={ids.backBtn}
        >
          {t('back')}
        </Button>
        <Button
          type="button"
          onClick={goNext}
          disabled={!canContinue || starting}
          title={step === 'columns' ? t('start') : t('next')}
          data-testid={step === 'columns' ? ids.startBtn : ids.nextBtn}
        >
          {starting ? <Spinner aria-hidden="true" /> : null}
          {step === 'columns' ? (starting ? t('starting') : t('start')) : t('next')}
        </Button>
      </CardFooter>
    </Card>
  );
}

export function StepIndicator({ current }: { current: number }) {
  const t = useTranslations('studentImport');
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        {t('stepOf', { current: current + 1, total: STEPS.length })}
      </p>
      <ol className="grid grid-cols-4 gap-2">
        {STEPS.map((name, i) => (
          <li
            key={name}
            aria-current={i === current ? 'step' : undefined}
            data-testid={ids.step(name)}
            className="flex min-w-0 flex-col gap-1.5"
          >
            <span
              className={cn(
                'h-1.5 rounded-full',
                i < current ? 'bg-primary' : i === current ? 'bg-primary/60' : 'bg-muted',
              )}
            />
            <span
              className={cn(
                'flex items-center gap-1 truncate text-xs sm:text-sm',
                i === current ? 'font-medium' : 'text-muted-foreground',
              )}
            >
              {i < current ? <Check className="size-3.5 shrink-0" aria-hidden="true" /> : null}
              {t(`steps.${name}`)}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function FileStep({
  picked,
  onFiles,
  onBusyChange,
}: {
  picked: PickedFile | null;
  onFiles: (fileIds: string[], files: File[]) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const t = useTranslations('studentImport');
  return (
    <div className="flex flex-col gap-5">
      <CardTitle>{t('file.heading')}</CardTitle>
      <Alert>
        <Info aria-hidden="true" />
        <AlertTitle>{t('file.sampleTitle')}</AlertTitle>
        <AlertDescription className="flex flex-col items-start gap-2">
          <p>{t('file.sampleBody')}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={downloadSampleCsv}
            title={t('file.sampleButton')}
            data-testid={ids.sampleBtn}
          >
            <Download aria-hidden="true" className="size-4" />
            {t('file.sampleButton')}
          </Button>
        </AlertDescription>
      </Alert>
      <FileUpload
        purpose="BULK_IMPORT_CSV"
        name="student-import"
        label={t('file.label')}
        description={t('file.description')}
        onChange={onFiles}
        onBusyChange={onBusyChange}
      />
      {picked?.problem ? (
        <FieldError data-testid={ids.headerError}>
          {t(`file.headerErrors.${picked.problem}`)}
        </FieldError>
      ) : null}
    </div>
  );
}

function TargetStep({
  target,
  onChange,
}: {
  target: Partial<ImportTarget>;
  onChange: (target: Partial<ImportTarget>) => void;
}) {
  const t = useTranslations('studentImport');
  const resolveI18n = useI18nField();
  const { data: yearsData } = useAcademicYearsForStudents();
  const years = yearsData?.academicYears ?? [];
  const activeYearId = years.find((year) => year.isActive)?.id;
  const academicYearId = target.academicYearId ?? activeYearId;
  const { data: standardsData, loading: standardsLoading } = useStandardsForYear(academicYearId);
  const standards = standardsData?.standards ?? [];
  const { data: sectionsData, loading: sectionsLoading } = useSectionsForStandard(
    target.standardId,
  );
  const sections = sectionsData?.sections ?? [];

  // The active year is the usual choice, so it is picked until the user picks another.
  React.useEffect(() => {
    if (!target.academicYearId && activeYearId) onChange({ academicYearId: activeYearId });
  }, [target.academicYearId, activeYearId, onChange]);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <CardTitle>{t('target.heading')}</CardTitle>
        <CardDescription>{t('target.description')}</CardDescription>
      </div>
      <FieldGroup className="grid gap-4 sm:grid-cols-3">
        <Field>
          <FieldLabel>{t('target.academicYear')}</FieldLabel>
          <Select
            value={academicYearId ?? ''}
            onValueChange={(value) => onChange({ academicYearId: value })}
          >
            <SelectTrigger data-testid={ids.yearSelect} aria-label={t('target.academicYear')}>
              <SelectValue placeholder={t('target.academicYearPlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              {years.map((year) => (
                <SelectItem key={year.id} value={year.id}>
                  {year.isActive ? `${year.label} (${t('target.active')})` : year.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel>{t('target.standard')}</FieldLabel>
          <Select
            value={target.standardId ?? ''}
            onValueChange={(value) => onChange({ academicYearId, standardId: value })}
            disabled={!academicYearId || standardsLoading || standards.length === 0}
          >
            <SelectTrigger data-testid={ids.standardSelect} aria-label={t('target.standard')}>
              <SelectValue placeholder={t('target.standardPlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              {standards.map((standard) => (
                <SelectItem key={standard.id} value={standard.id}>
                  {resolveI18n(standard.name)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {academicYearId && !standardsLoading && standards.length === 0 ? (
            <FieldDescription>{t('target.noStandards')}</FieldDescription>
          ) : null}
        </Field>
        <Field>
          <FieldLabel>{t('target.section')}</FieldLabel>
          <Select
            value={target.sectionId ?? ''}
            onValueChange={(value) => onChange({ ...target, academicYearId, sectionId: value })}
            disabled={!target.standardId || sectionsLoading || sections.length === 0}
          >
            <SelectTrigger data-testid={ids.sectionSelect} aria-label={t('target.section')}>
              <SelectValue placeholder={t('target.sectionPlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              {sections.map((section) => (
                <SelectItem key={section.id} value={section.id}>
                  {section.displayLabel ?? resolveI18n(section.name)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {target.standardId && !sectionsLoading && sections.length === 0 ? (
            <FieldDescription>{t('target.noSections')}</FieldDescription>
          ) : null}
        </Field>
      </FieldGroup>
    </div>
  );
}

function ColumnsStep({
  headers,
  mapping,
  onChange,
  problems,
}: {
  headers: string[];
  mapping: ColumnMapping;
  onChange: (mapping: ColumnMapping) => void;
  problems: ReturnType<typeof mappingProblems>;
}) {
  const t = useTranslations('studentImport');
  const fieldLabel = (field: StudentImportField) => t(`columns.fields.${field}`);
  const list = (fields: StudentImportField[]) => fields.map(fieldLabel).join(', ');

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <CardTitle>{t('columns.heading')}</CardTitle>
        <CardDescription>{t('columns.description')}</CardDescription>
      </div>
      <FieldGroup className="gap-4">
        {headers.map((header) => {
          const skippable = canSkipColumn(header);
          return (
            <Field
              key={header}
              className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] sm:items-start"
            >
              <FieldLabel className="break-all pt-2 font-mono text-sm">{header}</FieldLabel>
              <div className="flex min-w-0 flex-col gap-1">
                <Select
                  value={mapping[header] ?? SKIP}
                  onValueChange={(value) =>
                    onChange({
                      ...mapping,
                      [header]: isStudentImportField(value) ? value : null,
                    })
                  }
                >
                  <SelectTrigger
                    className="w-full"
                    aria-label={`${t('columns.field')}: ${header}`}
                    data-testid={ids.mappingSelect(header)}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {skippable ? <SelectItem value={SKIP}>{t('columns.skip')}</SelectItem> : null}
                    {STUDENT_IMPORT_FIELD_VALUES.map((field) => (
                      <SelectItem key={field} value={field}>
                        {fieldLabel(field)}
                        {STUDENT_IMPORT_REQUIRED_FIELDS.includes(field)
                          ? ` (${t('columns.required')})`
                          : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {skippable ? null : (
                  <FieldDescription className="text-xs">
                    {t('columns.autoMatched')}
                  </FieldDescription>
                )}
              </div>
            </Field>
          );
        })}
      </FieldGroup>
      {problems.missing.length > 0 || problems.duplicates.length > 0 ? (
        <div className="flex flex-col gap-1" role="alert" data-testid={ids.mappingError}>
          {problems.missing.length > 0 ? (
            <FieldError>{t('columns.missing', { fields: list(problems.missing) })}</FieldError>
          ) : null}
          {problems.duplicates.length > 0 ? (
            <FieldError>{t('columns.duplicate', { fields: list(problems.duplicates) })}</FieldError>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
