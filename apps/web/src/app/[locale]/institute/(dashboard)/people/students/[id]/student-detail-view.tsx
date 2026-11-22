'use client';

import {
  AcademicStatus,
  GENDER_VALUES,
  GUARDIAN_RELATIONSHIP_VALUES,
  type GuardianRelationship,
  SOCIAL_CATEGORY_VALUES,
  STUDENT_ACADEMIC_STATE_MACHINE,
  type TcStatus,
} from '@roviq/common-types';
import { extractGraphQLErrorCode, gql, useMutation } from '@roviq/graphql';
import type { MinorityType, UpdateStudentInput } from '@roviq/graphql/generated';
import {
  buildI18nTextSchema,
  emptyStringToUndefined,
  Link as LocaleLink,
  useFormatDate,
  useI18nField,
  useInstituteLocales,
  zodValidator,
} from '@roviq/i18n';
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Badge,
  Button,
  Can,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  DataTable,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EntityTimeline,
  Field,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
  I18nField,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  Skeleton,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  useAppForm,
  useBreadcrumbOverride,
} from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { useStore } from '@tanstack/react-form';
import { type ColumnDef, createColumnHelper } from '@tanstack/react-table';
import { FileDownloadButton } from '@web/components/file-upload/file-download-button';
import { FileUpload } from '@web/components/file-upload/file-upload';
import { fileUploadErrorKey } from '@web/components/file-upload/use-file-upload';
import { ViewAsButton } from '@web/components/impersonation/view-as-button';
import { DeletePersonButton } from '@web/components/people/deleted-records';
import { ProfilePhotoButton } from '@web/components/people/profile-photo-button';
import { useDebouncedValue } from '@web/hooks/use-debounced-value';
import { useFormDraft } from '@web/hooks/use-form-draft';
import { parseISO } from 'date-fns';
import {
  AlertTriangle,
  ArrowLeft,
  CalendarCheck,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronsUpDown,
  ClipboardList,
  FileText,
  GraduationCap,
  History,
  Info,
  Loader2,
  MoveRight,
  Plus,
  ShieldCheck,
  Star,
  UserMinus,
  UserPlus,
  UserRound,
  Users,
  XCircle,
} from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { parseAsString, useQueryState } from 'nuqs';
import * as React from 'react';
import { useState } from 'react';
import { ErrorBoundary, useErrorBoundary } from 'react-error-boundary';
import { toast } from 'sonner';
import { z } from 'zod';
import {
  type AttendanceStatus,
  type StudentHistoryItem,
  useStudentHistory,
} from '../../../attendance/use-attendance';
import { useLinkGuardianToStudent } from '../../guardians/use-guardians';
import { PersonNameLink, usePersonDetailContext } from '../../person-detail-dialog';
import { UnlinkGuardianButton } from '../../unlink-guardian-dialog';
import { useLinkErrorMessage } from '../../use-link-error-message';
import { ChangeClassDialog, EnrolStudentDialog, RemoveFromYearDialog } from '../placement-dialogs';
import {
  type GuardianPickerNode,
  type StudentDetailNode,
  useAcademicYearsForStudents,
  useGuardiansForStudentPicker,
  useStudent,
  useStudentAcademics,
  useStudentDocuments,
  useStudentGuardians,
  useStudentTCs,
  useUpdateStudent,
  useUploadStudentDocument,
} from '../use-students';
import { RemoveDocumentButton } from './remove-document-button';

const { instituteStudents } = testIds;
/**
 * Document types enforced by the `chk_document_type` CHECK constraint on
 * `user_documents.type`. Must stay in sync with the Zod enum and with the
 * `detail.documents.types.*` i18n keys.
 */
const DOCUMENT_TYPES = [
  'BIRTH_CERTIFICATE',
  'TC_INCOMING',
  'REPORT_CARD',
  'AADHAAR_CARD',
  'CASTE_CERTIFICATE',
  'INCOME_CERTIFICATE',
  'EWS_CERTIFICATE',
  'MEDICAL_CERTIFICATE',
  'DISABILITY_CERTIFICATE',
  'ADDRESS_PROOF',
  'PASSPORT_PHOTO',
  'FAMILY_PHOTO',
  'BPL_CARD',
  'TRANSFER_ORDER',
  'NOC',
  'AFFIDAVIT',
  'OTHER',
] as const;

const MAX_DOCUMENT_FILES = 10;

const uploadDocumentSchema = z.object({
  type: z.enum(DOCUMENT_TYPES),
  description: emptyStringToUndefined(z.string().max(255).optional()),
  fileIds: z.array(z.string()).min(1).max(MAX_DOCUMENT_FILES),
  referenceNumber: emptyStringToUndefined(z.string().max(100).optional()),
});
type UploadDocumentSchema = typeof uploadDocumentSchema;
type UploadDocumentFormValues = z.input<UploadDocumentSchema>;

/**
 * Fallback rendered when an ErrorBoundary around a student-detail tab catches
 * a runtime error. Isolates failures to the tab body so other tabs and the
 * page shell keep working. Implements rule [OPULR] from frontend-ux.
 */
function TabErrorFallback() {
  const t = useTranslations('students');
  const { resetBoundary } = useErrorBoundary();
  return (
    <Empty className="py-12">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <AlertTriangle aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>{t('detail.tabError')}</EmptyTitle>
        <EmptyDescription>{t('detail.tabErrorDescription')}</EmptyDescription>
      </EmptyHeader>
      <Button variant="outline" size="sm" onClick={resetBoundary}>
        {t('detail.tabRetry')}
      </Button>
    </Empty>
  );
}

/** 10-status TC lifecycle — mirrors tc_register.status state machine. */
const TC_STATUS_CLASS: Record<TcStatus, string> = {
  REQUESTED: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  CLEARANCE_PENDING: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
  CLEARANCE_COMPLETE: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900 dark:text-cyan-300',
  GENERATED: 'bg-sky-100 text-sky-700 dark:bg-sky-900 dark:text-sky-300',
  REVIEW_PENDING: 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300',
  APPROVED: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300',
  ISSUED: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
  CANCELLED: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  DUPLICATE_REQUESTED: 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300',
  DUPLICATE_ISSUED: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300',
};

// Imported from the shared backend state machine — single source of truth.
// A transition rename here is a compile error in every consumer; the
// previous local copy was famous for drifting from the backend.
const STUDENT_STATUS_TRANSITIONS = STUDENT_ACADEMIC_STATE_MACHINE.transitions;

/**
 * Destructive transitions require a typed reason for audit traceability.
 * The backend also rejects these transitions without a reason, but the
 * frontend validates with Zod so users see the error before the mutation.
 */
const DESTRUCTIVE_TRANSITIONS = new Set<string>([
  AcademicStatus.WITHDRAWN,
  AcademicStatus.DROPPED_OUT,
  AcademicStatus.TRANSFERRED_OUT,
  AcademicStatus.EXPELLED,
]);

const TRANSITION_STUDENT_STATUS = gql`
  mutation TransitionStudentStatus($id: ID!, $newStatus: AcademicStatus!, $reason: String) {
    transitionStudentStatus(id: $id, newStatus: $newStatus, reason: $reason) {
      id
      academicStatus
      version
    }
  }
`;

type TransitionStudentStatusData = {
  transitionStudentStatus: { id: string; academicStatus: string; version: number };
};

type TransitionStudentStatusVars = {
  id: string;
  newStatus: string;
  reason?: string;
};

function useTransitionStudentStatus() {
  return useMutation<TransitionStudentStatusData, TransitionStudentStatusVars>(
    TRANSITION_STUDENT_STATUS,
    { refetchQueries: ['InstituteStudent', 'InstituteStudents'] },
  );
}

/** The full student detail — rendered by the route page and inside the person popup. */
export function StudentDetailView({ studentId }: { studentId: string }) {
  const router = useRouter();
  const { embedded, exit } = usePersonDetailContext();
  const t = useTranslations('students');
  const { data, loading, error, refetch } = useStudent(studentId);
  const resolveI18nName = useI18nField();
  const student = data?.getStudent;
  useBreadcrumbOverride(
    student && !embedded
      ? {
          [studentId]: [resolveI18nName(student.firstName), resolveI18nName(student.lastName)]
            .filter(Boolean)
            .join(' '),
        }
      : {},
  );
  const backToList = embedded ? exit : () => router.push('/institute/people/students');

  if (loading && !data) {
    return <StudentDetailSkeleton />;
  }

  if (error || !student) {
    return (
      <div className="space-y-4">
        {!embedded && (
          <Button variant="ghost" size="sm" onClick={backToList}>
            <ArrowLeft aria-hidden="true" className="size-4" />
            {t('detail.back')}
          </Button>
        )}
        <Empty className="py-16">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <AlertTriangle aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>{t('detail.notFound')}</EmptyTitle>
            <EmptyDescription>{t('detail.notFoundDescription')}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    );
  }

  return (
    <Can I="read" a="Student" passThrough>
      {(allowed: boolean) =>
        allowed ? (
          <div className="space-y-6">
            <StudentHeader student={student} onBack={backToList} showBack={!embedded} />

            {/*
              D1+D2 sidebar layout — 2-column grid with a sticky 280px sidebar
              showing the student's photo, admission number, current placement,
              and quick stats. Implements rule [LEYPF] and the spec sidebar
              requirement. The sidebar is `print:hidden` so printed pages get
              the full-width content area.
            */}
            <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
              <aside className="lg:sticky lg:top-6 self-start space-y-4 print:hidden">
                <StudentSidebar student={student} />
              </aside>

              <div className="space-y-4 print:max-w-none">
                <Tabs defaultValue="profile" className="space-y-4">
                  <TabsList className="print:hidden">
                    <TabsTrigger
                      value="profile"
                      data-testid={instituteStudents.detailTab('profile')}
                    >
                      <UserRound aria-hidden="true" className="size-4" />
                      {t('detail.tabs.profile')}
                    </TabsTrigger>
                    <TabsTrigger
                      value="academics"
                      data-testid={instituteStudents.detailTab('academics')}
                    >
                      <GraduationCap aria-hidden="true" className="size-4" />
                      {t('detail.tabs.academics')}
                    </TabsTrigger>
                    <Can I="read" a="Attendance">
                      <TabsTrigger
                        value="attendance"
                        data-testid={instituteStudents.detailTab('attendance')}
                      >
                        <CalendarCheck aria-hidden="true" className="size-4" />
                        {t('detail.tabs.attendance')}
                      </TabsTrigger>
                    </Can>
                    <TabsTrigger
                      value="guardians"
                      data-testid={instituteStudents.detailTab('guardians')}
                    >
                      <Users aria-hidden="true" className="size-4" />
                      {t('detail.tabs.guardians')}
                    </TabsTrigger>
                    <TabsTrigger
                      value="documents"
                      data-testid={instituteStudents.detailTab('documents')}
                    >
                      <FileText aria-hidden="true" className="size-4" />
                      {t('detail.tabs.documents')}
                    </TabsTrigger>
                    <TabsTrigger value="tc" data-testid={instituteStudents.detailTab('tc-history')}>
                      <ClipboardList aria-hidden="true" className="size-4" />
                      {t('detail.tabs.tc')}
                    </TabsTrigger>
                    <TabsTrigger value="audit" data-testid={instituteStudents.detailTab('audit')}>
                      <History aria-hidden="true" className="size-4" />
                      {t('detail.tabs.audit')}
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="profile">
                    <ErrorBoundary FallbackComponent={TabErrorFallback}>
                      <ProfileTab student={student} refetch={() => void refetch()} />
                    </ErrorBoundary>
                  </TabsContent>
                  <TabsContent value="academics">
                    <ErrorBoundary FallbackComponent={TabErrorFallback}>
                      <AcademicsTab student={student} />
                    </ErrorBoundary>
                  </TabsContent>
                  <TabsContent value="attendance">
                    <ErrorBoundary FallbackComponent={TabErrorFallback}>
                      <Can I="read" a="Attendance">
                        {student.membershipId && (
                          <StudentAttendanceTab membershipId={student.membershipId} />
                        )}
                      </Can>
                    </ErrorBoundary>
                  </TabsContent>
                  <TabsContent value="guardians">
                    <ErrorBoundary FallbackComponent={TabErrorFallback}>
                      <GuardiansTab
                        studentProfileId={student.id}
                        studentName={[
                          resolveI18nName(student.firstName),
                          resolveI18nName(student.lastName),
                        ]
                          .filter(Boolean)
                          .join(' ')}
                      />
                    </ErrorBoundary>
                  </TabsContent>
                  <TabsContent value="documents">
                    <ErrorBoundary FallbackComponent={TabErrorFallback}>
                      <DocumentsTab studentProfileId={student.id} userId={student.userId ?? null} />
                    </ErrorBoundary>
                  </TabsContent>
                  <TabsContent value="tc">
                    <ErrorBoundary FallbackComponent={TabErrorFallback}>
                      <TCHistoryTab studentProfileId={student.id} />
                    </ErrorBoundary>
                  </TabsContent>
                  <TabsContent value="audit">
                    <ErrorBoundary FallbackComponent={TabErrorFallback}>
                      <AuditTab studentId={student.id} />
                    </ErrorBoundary>
                  </TabsContent>
                </Tabs>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center min-h-[400px]">
            <p className="text-muted-foreground">{t('accessDenied')}</p>
          </div>
        )
      }
    </Can>
  );
}

// ─── Sidebar (D1+D2 from frontend-ux audit) ───────────────────────────────

/**
 * Left sidebar shown alongside the student detail tabs. Displays the
 * student's photo, admission number, current placement, status badge, and
 * a small set of quick stats. Implements rule [LEYPF] / [LODGO] from
 * frontend-ux. Hidden in print views via `print:hidden` on the wrapping
 * `<aside>` so the printable layout doesn't carry the sidebar gutter.
 */
function StudentSidebar({ student }: { student: StudentDetailNode }) {
  const t = useTranslations('students');
  const { format } = useFormatDate();
  const resolveI18n = useI18nField();
  const firstName = resolveI18n(student.firstName);
  const lastName = resolveI18n(student.lastName);
  const fullName = [firstName, lastName].filter(Boolean).join(' ');
  const { data: academicsData } = useStudentAcademics(student.id);
  const currentEnrollment = academicsData?.listStudentAcademics.find((row) => row.isCurrentYear);
  const standardLabel = currentEnrollment ? resolveI18n(currentEnrollment.standardName) : null;
  const sectionLabel = currentEnrollment?.sectionName
    ? resolveI18n(currentEnrollment.sectionName)
    : null;
  const placementLabel = [standardLabel, sectionLabel].filter(Boolean).join(' · ') || '—';
  // Initials for the avatar fallback — first letters of first + last name in
  // the resolved locale. Capped at 2 chars to keep the avatar legible.
  const initials =
    [firstName, lastName]
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase())
      .join('')
      .slice(0, 2) || '?';

  return (
    <Card>
      <CardContent className="pt-6 space-y-4">
        <div className="flex flex-col items-center text-center space-y-3">
          <Avatar className="size-24">
            {student.profileImage?.url ? (
              <AvatarImage src={student.profileImage?.url} alt={fullName} />
            ) : null}
            <AvatarFallback className="text-2xl">{initials}</AvatarFallback>
          </Avatar>
          {student.userId ? (
            <Can I="update" a="Student">
              <ProfilePhotoButton
                kind="student"
                profileId={student.id}
                userId={student.userId}
                name={fullName}
                hasPhoto={Boolean(student.profileImage)}
              />
            </Can>
          ) : null}
          <div className="space-y-1">
            <p className="font-semibold leading-tight">{fullName}</p>
            <p className="text-xs font-mono text-muted-foreground">{student.admissionNumber}</p>
          </div>
          <Badge variant="secondary" className="text-xs">
            {student.academicStatus
              ? t(`academicStatuses.${student.academicStatus}`, { default: student.academicStatus })
              : '—'}
          </Badge>
          <Can I="update" a="Student">
            <StatusTransitionControl student={student} />
          </Can>
        </div>

        <Separator />

        <div className="space-y-3 text-sm">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              {t('detail.sidebar.currentPlacement')}
            </p>
            <p className="font-medium">{placementLabel}</p>
            {currentEnrollment?.sectionId && (
              <Can I="read" a="Timetable">
                <Button
                  variant="link"
                  size="sm"
                  className="h-auto gap-1.5 p-0"
                  asChild
                  title={t('detail.sidebar.viewTimetable')}
                >
                  <LocaleLink
                    href={`/institute/timetable/section-timetable?section=${currentEnrollment.sectionId}&standard=${currentEnrollment.standardId}`}
                    data-testid={testIds.instituteStudents.detailViewTimetableLink}
                  >
                    <CalendarClock className="size-3.5" />
                    {t('detail.sidebar.viewTimetable')}
                  </LocaleLink>
                </Button>
              </Can>
            )}
            <Can I="read" a="ReportCard">
              <Button
                variant="link"
                size="sm"
                className="h-auto gap-1.5 p-0"
                asChild
                title={t('detail.sidebar.viewExams')}
              >
                <LocaleLink
                  href="/institute/examinations/report-cards"
                  data-testid={testIds.instituteStudents.detailViewExamsLink}
                >
                  <GraduationCap className="size-3.5" />
                  {t('detail.sidebar.viewExams')}
                </LocaleLink>
              </Button>
            </Can>
          </div>

          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              {t('detail.sidebar.admittedOn')}
            </p>
            <p className="font-medium">{format(parseISO(student.admissionDate), 'dd/MM/yyyy')}</p>
          </div>

          {student.dateOfBirth && (
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                {t('detail.sidebar.dateOfBirth')}
              </p>
              <p className="font-medium">{format(parseISO(student.dateOfBirth), 'dd/MM/yyyy')}</p>
            </div>
          )}

          {student.gender && (
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                {t('detail.sidebar.gender')}
              </p>
              <p className="font-medium">
                {t(`genders.${student.gender}`, { default: student.gender })}
              </p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Status transition control — shown in the sidebar under the status badge.
 * Renders a Select with only the valid next states for the student's current
 * academic status (per `STUDENT_STATUS_TRANSITIONS`). Destructive transitions
 * (withdraw, expel, drop out, transfer out) open a confirmation Dialog that
 * captures a reason (min 10 chars, validated via Zod). Non-destructive
 * transitions fire the mutation immediately.
 *
 * The mutation is scoped via `@InstituteScope` on the backend; authorisation
 * is enforced both server-side (CASL) and client-side via the `<Can>` wrapper
 * in the parent.
 */
const transitionReasonSchema = z.object({
  reason: z.string().min(10),
});
type TransitionReasonSchema = typeof transitionReasonSchema;
type TransitionReasonValues = z.input<TransitionReasonSchema>;

function StatusTransitionControl({ student }: { student: StudentDetailNode }) {
  const t = useTranslations('students');
  const tError = useTranslations('error');
  const [transitionStatus, { loading }] = useTransitionStudentStatus();
  const [pendingStatus, setPendingStatus] = useState<string | null>(null);

  const reasonForm = useAppForm({
    defaultValues: { reason: '' } as TransitionReasonValues,
    validators: {
      onChange: zodValidator(transitionReasonSchema),
      onSubmit: zodValidator(transitionReasonSchema),
    },
    onSubmit: async ({ value }) => {
      if (!pendingStatus) return;
      await runTransition(pendingStatus, value.reason);
    },
  });

  const validTransitions = student.academicStatus
    ? (STUDENT_STATUS_TRANSITIONS[student.academicStatus] ?? [])
    : [];

  const runTransition = async (newStatus: string, reason?: string) => {
    try {
      await transitionStatus({
        variables: { id: student.id, newStatus, reason },
      });
      toast.success(t('detail.status.updated'));
      setPendingStatus(null);
      reasonForm.reset({ reason: '' });
    } catch {
      toast.error(t('detail.status.updateFailed'), { description: tError('errorDescription') });
    }
  };

  const handleSelect = (newStatus: string) => {
    if (DESTRUCTIVE_TRANSITIONS.has(newStatus)) {
      setPendingStatus(newStatus);
      return;
    }
    void runTransition(newStatus);
  };

  if (validTransitions.length === 0) {
    return null;
  }

  return (
    <div className="w-full">
      <Select value="" onValueChange={handleSelect} disabled={loading}>
        <SelectTrigger className="w-full" aria-label={t('detail.status.changeLabel')}>
          <SelectValue
            placeholder={loading ? t('detail.status.updating') : t('detail.status.changeLabel')}
          />
        </SelectTrigger>
        <SelectContent>
          {validTransitions.map((status) => (
            <SelectItem key={status} value={status}>
              {t(`academicStatuses.${status}`, { default: status })}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Dialog
        open={pendingStatus !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingStatus(null);
            reasonForm.reset({ reason: '' });
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('detail.status.confirmTitle')}</DialogTitle>
            <DialogDescription>
              {t('detail.status.confirmDescription', {
                status: pendingStatus
                  ? t(`academicStatuses.${pendingStatus}`, { default: pendingStatus })
                  : '',
              })}
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              e.stopPropagation();
              void reasonForm.handleSubmit();
            }}
            className="space-y-4"
          >
            <reasonForm.AppField name="reason">
              {(field) => (
                <field.TextareaField
                  label={t('detail.status.reason')}
                  placeholder={t('detail.status.reasonPlaceholder')}
                  rows={4}
                  testId="students-detail-transition-reason-input"
                  errorTestId="students-detail-transition-reason-error"
                />
              )}
            </reasonForm.AppField>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setPendingStatus(null);
                  reasonForm.reset({ reason: '' });
                }}
                disabled={loading}
              >
                {t('detail.status.cancel')}
              </Button>
              <reasonForm.AppForm>
                <reasonForm.SubmitButton
                  variant="destructive"
                  disabled={loading}
                  submittingLabel={t('detail.status.updating')}
                  testId="students-detail-transition-confirm-btn"
                >
                  {loading ? t('detail.status.updating') : t('detail.status.confirm')}
                </reasonForm.SubmitButton>
              </reasonForm.AppForm>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Header card ──────────────────────────────────────────────────────────

function StudentHeader({
  student,
  onBack,
  showBack,
}: {
  student: StudentDetailNode;
  onBack: () => void;
  showBack: boolean;
}) {
  const t = useTranslations('students');
  const resolveI18n = useI18nField();
  const fullName = [resolveI18n(student.firstName), resolveI18n(student.lastName)]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 print:hidden">
        {showBack ? (
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft aria-hidden="true" className="size-4" />
            {t('detail.back')}
          </Button>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-2">
          {student.userId && <ViewAsButton userId={student.userId} name={fullName} />}
          <DeletePersonButton kind="student" id={student.id} name={fullName} onDeleted={onBack} />
        </div>
      </div>
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1
            data-testid={instituteStudents.detailTitle}
            className="text-2xl font-bold tracking-tight"
          >
            {fullName}
          </h1>
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <span className="font-mono">{student.admissionNumber}</span>
            <span>·</span>
            <span>
              {student.academicStatus
                ? t(`academicStatuses.${student.academicStatus}`, {
                    default: student.academicStatus,
                  })
                : '—'}
            </span>
            {student.isRteAdmitted && (
              <Badge variant="outline" className="border-emerald-300 text-emerald-700">
                <ShieldCheck aria-hidden="true" className="size-3" />
                {t('rte.yes')}
              </Badge>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Profile tab (editable) ───────────────────────────────────────────────

/**
 * Build the Zod schema for the editable subset of student profile fields.
 * Only fields that are semantically safe to change post-enrollment are
 * editable here — admission number, dates, and status transitions are NOT
 * edited here (status changes are named domain mutations per the
 * entity-lifecycle rule).
 *
 * Built lazily inside the component so the i18n `t()` function can supply
 * translated error messages on the i18nText fields.
 */
function buildProfileSchema(t: ReturnType<typeof useTranslations>, defaultLocale: string) {
  return z.object({
    firstName: buildI18nTextSchema(t('detail.profile.firstNameRequired'), defaultLocale),
    lastName: buildI18nTextSchema(t('detail.profile.lastNameRequired'), defaultLocale).optional(),
    gender: emptyStringToUndefined(z.enum(['MALE', 'FEMALE', 'OTHER']).optional()),
    dateOfBirth: emptyStringToUndefined(z.string().optional()),
    socialCategory: z.enum(['GENERAL', 'OBC', 'SC', 'ST', 'EWS']),
    bloodGroup: emptyStringToUndefined(z.string().optional()),
    religion: emptyStringToUndefined(z.string().optional()),
    caste: emptyStringToUndefined(z.string().optional()),
    motherTongue: emptyStringToUndefined(z.string().optional()),
    isRteAdmitted: z.boolean(),
    isCwsn: z.boolean(),
    cwsnType: emptyStringToUndefined(z.string().optional()),
    isMinority: z.boolean(),
    minorityType: emptyStringToUndefined(z.string().optional()),
    isBpl: z.boolean(),
  });
}

type ProfileSchema = ReturnType<typeof buildProfileSchema>;
type ProfileFormValues = z.input<ProfileSchema>;

function ProfileTab({ student, refetch }: { student: StudentDetailNode; refetch: () => void }) {
  const t = useTranslations('students');
  const tError = useTranslations('error');
  const { format } = useFormatDate();
  const [updateStudent, { loading }] = useUpdateStudent();

  const { defaultLocale } = useInstituteLocales();
  const schema = React.useMemo(() => buildProfileSchema(t, defaultLocale), [t, defaultLocale]);

  // Backfill every locale key with `''` so TanStack's `form.Field
  // name="firstName.hi"` always sees a string, matching the I18nField row
  // contract. The backend may omit non-default locale keys.
  const defaultValues: ProfileFormValues = React.useMemo(
    () => ({
      firstName: { en: student.firstName?.en ?? '', hi: student.firstName?.hi ?? '' },
      lastName: student.lastName
        ? { en: student.lastName.en ?? '', hi: student.lastName.hi ?? '' }
        : undefined,
      gender: (student.gender as ProfileFormValues['gender']) ?? undefined,
      dateOfBirth: student.dateOfBirth ?? '',
      socialCategory: student.socialCategory as ProfileFormValues['socialCategory'],
      bloodGroup: student.bloodGroup ?? '',
      religion: student.religion ?? '',
      caste: student.caste ?? '',
      motherTongue: student.motherTongue ?? '',
      isRteAdmitted: student.isRteAdmitted ?? false,
      isCwsn: student.isCwsn ?? false,
      cwsnType: student.cwsnType ?? '',
      isMinority: student.isMinority ?? false,
      minorityType: student.minorityType ?? '',
      isBpl: student.isBpl ?? false,
    }),
    [student],
  );

  const form = useAppForm({
    defaultValues,
    validators: { onChange: zodValidator(schema), onSubmit: zodValidator(schema) },
    onSubmit: async ({ value }) => {
      if (student.version == null) return;
      const parsed = schema.parse(value);
      try {
        const input: UpdateStudentInput = {
          firstName: parsed.firstName,
          lastName: parsed.lastName,
          gender: parsed.gender,
          dateOfBirth: parsed.dateOfBirth,
          socialCategory: parsed.socialCategory,
          bloodGroup: parsed.bloodGroup,
          religion: parsed.religion,
          caste: parsed.caste,
          motherTongue: parsed.motherTongue,
          isRteAdmitted: parsed.isRteAdmitted,
          isCwsn: parsed.isCwsn,
          cwsnType: parsed.isCwsn ? parsed.cwsnType : undefined,
          isMinority: parsed.isMinority,
          minorityType: parsed.isMinority
            ? (parsed.minorityType as MinorityType | undefined)
            : undefined,
          isBpl: parsed.isBpl,
          version: student.version,
        };
        await updateStudent({ variables: { id: student.id, input } });
        toast.success(t('detail.profile.saved'));
        clearDraft();
        // Reset dirty flag so the Save button re-disables, keeping the just-
        // submitted values as the new baseline.
        form.reset(value);
      } catch (err) {
        if (extractGraphQLErrorCode(err) === 'CONCURRENT_MODIFICATION') {
          toast.error(t('detail.profile.concurrencyError'), {
            action: {
              label: t('detail.profile.refresh'),
              onClick: () => refetch(),
            },
          });
        } else {
          toast.error(t('detail.profile.saveFailed'), { description: tError('errorDescription') });
        }
      }
    },
  });

  const { hasDraft, restoreDraft, discardDraft, clearDraft } = useFormDraft<ProfileFormValues>({
    key: `student-profile:${student.id}`,
    form,
    enabled: !loading,
  });

  // Drive the submit-button disabled state and dependent toggles without
  // re-rendering the whole tab on every keystroke.
  const isDirty = useStore(form.store, (state) => state.isDirty);
  const isCwsn = useStore(form.store, (state) => (state.values as ProfileFormValues).isCwsn);
  const isMinority = useStore(
    form.store,
    (state) => (state.values as ProfileFormValues).isMinority,
  );

  const genderOptions = GENDER_VALUES.map((g) => ({ value: g, label: t(`genders.${g}`) }));
  const socialOptions = SOCIAL_CATEGORY_VALUES.map((c) => ({
    value: c,
    label: t(`socialCategories.${c}`),
  }));

  return (
    <Card className="print:break-inside-avoid">
      <CardHeader>
        <CardTitle>{t('detail.profile.title')}</CardTitle>
      </CardHeader>
      <CardContent>
        {hasDraft && (
          <div className="mb-4 flex items-center justify-between rounded-md border border-amber-300 bg-amber-50 px-4 py-3 dark:border-amber-700 dark:bg-amber-950">
            <div className="text-sm">
              <p className="font-medium text-amber-900 dark:text-amber-200">
                {t('detail.profile.draftFound')}
              </p>
              <p className="text-xs text-amber-700 dark:text-amber-300">
                {t('detail.profile.draftFoundDescription')}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={discardDraft}
                data-testid={instituteStudents.detailDraftDiscardBtn}
              >
                {t('detail.profile.draftDiscard')}
              </Button>
              <Button
                size="sm"
                onClick={restoreDraft}
                data-testid={instituteStudents.detailDraftRestoreBtn}
              >
                {t('detail.profile.draftRestore')}
              </Button>
            </div>
          </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void form.handleSubmit();
          }}
          noValidate
          className="space-y-6"
        >
          <FieldSet className="print:break-inside-avoid">
            <FieldLegend>{t('detail.profile.sections.personal')}</FieldLegend>
            <FieldGroup className="grid gap-4 sm:grid-cols-2">
              <I18nField
                form={form}
                name="firstName"
                label={t('detail.profile.firstName')}
                testId="students-detail-first-name-input"
              />
              <I18nField
                form={form}
                name="lastName"
                label={t('detail.profile.lastName')}
                testId="students-detail-last-name-input"
              />
              <form.AppField name="gender">
                {(field) => (
                  <field.SelectField
                    label={t('detail.profile.gender')}
                    options={genderOptions}
                    placeholder={t('detail.profile.genderPlaceholder')}
                    testId="students-detail-gender-select"
                  />
                )}
              </form.AppField>
              <form.AppField name="dateOfBirth">
                {(field) => (
                  <field.DateField
                    label={t('detail.profile.dateOfBirth')}
                    testId={instituteStudents.detailDobInput}
                  />
                )}
              </form.AppField>
              <form.AppField name="bloodGroup">
                {(field) => (
                  <field.TextField
                    label={t('detail.profile.bloodGroup')}
                    testId="students-detail-blood-group-input"
                  />
                )}
              </form.AppField>
            </FieldGroup>
          </FieldSet>

          <FieldSet className="print:break-inside-avoid">
            <FieldLegend>{t('detail.profile.sections.identity')}</FieldLegend>
            <FieldGroup className="grid gap-4 sm:grid-cols-2">
              <form.AppField name="religion">
                {(field) => (
                  <field.TextField
                    label={t('detail.profile.religion')}
                    testId="students-detail-religion-input"
                  />
                )}
              </form.AppField>
              <form.AppField name="caste">
                {(field) => (
                  <field.TextField
                    label={
                      <>
                        {t('detail.profile.caste')}
                        <HoverCard>
                          <HoverCardTrigger asChild>
                            <Info
                              className="ms-2 size-3.5 text-muted-foreground cursor-help"
                              aria-hidden="true"
                            />
                          </HoverCardTrigger>
                          <HoverCardContent className="w-80 text-sm">
                            {t('detail.profile.casteHelp')}
                          </HoverCardContent>
                        </HoverCard>
                      </>
                    }
                    description={t('detail.profile.casteDescription')}
                    testId="students-detail-caste-input"
                  />
                )}
              </form.AppField>
              <form.AppField name="motherTongue">
                {(field) => (
                  <field.TextField
                    label={
                      <>
                        {t('detail.profile.motherTongue')}
                        <HoverCard>
                          <HoverCardTrigger asChild>
                            <Info
                              className="ms-2 size-3.5 text-muted-foreground cursor-help"
                              aria-hidden="true"
                            />
                          </HoverCardTrigger>
                          <HoverCardContent className="w-80 text-sm">
                            {t('detail.profile.motherTongueHelp')}
                          </HoverCardContent>
                        </HoverCard>
                      </>
                    }
                    description={t('detail.profile.motherTongueDescription')}
                    testId="students-detail-mother-tongue-input"
                  />
                )}
              </form.AppField>
            </FieldGroup>
          </FieldSet>

          <FieldSet className="print:break-inside-avoid">
            <FieldLegend>{t('detail.profile.sections.regulatory')}</FieldLegend>
            <FieldGroup className="grid gap-4 sm:grid-cols-2">
              <form.AppField name="socialCategory">
                {(field) => (
                  <field.SelectField
                    label={
                      <>
                        {t('detail.profile.category')}
                        <HoverCard>
                          <HoverCardTrigger asChild>
                            <Info
                              className="ms-2 size-3.5 text-muted-foreground cursor-help"
                              aria-hidden="true"
                            />
                          </HoverCardTrigger>
                          <HoverCardContent className="w-80 text-sm">
                            {t('detail.profile.socialCategoryHelp')}
                          </HoverCardContent>
                        </HoverCard>
                      </>
                    }
                    options={socialOptions}
                    optional={false}
                    description={t('detail.profile.socialCategoryDescription')}
                    testId="students-detail-social-category-select"
                  />
                )}
              </form.AppField>
              <form.AppField name="isRteAdmitted">
                {(field) => (
                  <field.SwitchField
                    label={
                      <>
                        {t('detail.profile.rteAdmitted')}
                        <HoverCard>
                          <HoverCardTrigger asChild>
                            <Info
                              className="ms-2 size-3.5 text-muted-foreground cursor-help"
                              aria-hidden="true"
                            />
                          </HoverCardTrigger>
                          <HoverCardContent className="w-80 text-sm">
                            {t('detail.profile.rteAdmittedHelp')}
                          </HoverCardContent>
                        </HoverCard>
                      </>
                    }
                    description={t('detail.profile.rteAdmittedDescription')}
                    testId="students-detail-rte-admitted-switch"
                  />
                )}
              </form.AppField>
              <form.AppField name="isCwsn">
                {(field) => (
                  <field.SwitchField
                    label={t('detail.profile.cwsn')}
                    testId="students-detail-cwsn-switch"
                  />
                )}
              </form.AppField>
              {isCwsn && (
                <form.AppField name="cwsnType">
                  {(field) => (
                    <field.TextField
                      label={t('detail.profile.cwsnTypeLabel')}
                      testId="students-detail-cwsn-type-input"
                    />
                  )}
                </form.AppField>
              )}
              <form.AppField name="isMinority">
                {(field) => (
                  <field.SwitchField
                    label={t('detail.profile.minority')}
                    testId="students-detail-minority-switch"
                  />
                )}
              </form.AppField>
              {isMinority && (
                <form.AppField name="minorityType">
                  {(field) => (
                    <field.TextField
                      label={t('detail.profile.minorityTypeLabel')}
                      testId="students-detail-minority-type-input"
                    />
                  )}
                </form.AppField>
              )}
              <form.AppField name="isBpl">
                {(field) => (
                  <field.SwitchField
                    label={t('detail.profile.bpl')}
                    testId="students-detail-bpl-switch"
                  />
                )}
              </form.AppField>
            </FieldGroup>
          </FieldSet>

          <FieldSet className="print:break-inside-avoid">
            <FieldLegend>{t('detail.profile.admissionInfo')}</FieldLegend>
            <FieldGroup className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel>{t('detail.profile.admissionNumber')}</FieldLabel>
                <p className="text-sm font-mono">{student.admissionNumber}</p>
              </Field>
              <Field>
                <FieldLabel>{t('detail.profile.admittedOn')}</FieldLabel>
                <p className="text-sm">{format(parseISO(student.admissionDate), 'dd/MM/yyyy')}</p>
              </Field>
              {student.admissionClass && (
                <Field>
                  <FieldLabel>{t('detail.profile.admissionClass')}</FieldLabel>
                  <p className="text-sm">{student.admissionClass}</p>
                </Field>
              )}
              <Field>
                <FieldLabel>{t('detail.profile.admissionType')}</FieldLabel>
                <p className="text-sm">{student.admissionType}</p>
              </Field>
            </FieldGroup>
          </FieldSet>

          <FieldSet className="print:break-inside-avoid">
            <FieldLegend>{t('detail.profile.medicalInfo')}</FieldLegend>
            {student.medicalInfo && Object.keys(student.medicalInfo).length > 0 ? (
              <FieldGroup className="grid gap-4 sm:grid-cols-2">
                {Object.entries(student.medicalInfo).map(([key, value]) => (
                  <Field key={key}>
                    <FieldLabel className="capitalize">{key.replace(/_/g, ' ')}</FieldLabel>
                    <p className="text-sm">{String(value ?? '—')}</p>
                  </Field>
                ))}
              </FieldGroup>
            ) : (
              <p className="text-sm text-muted-foreground">{t('detail.profile.medicalEmpty')}</p>
            )}
          </FieldSet>

          <Separator />

          <div className="text-xs text-muted-foreground">
            {t('detail.profile.version')}: <span className="font-mono">v{student.version}</span>
          </div>

          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={!isDirty || loading}
              onClick={() => form.reset()}
              data-testid={instituteStudents.detailResetBtn}
            >
              {t('detail.profile.reset')}
            </Button>
            <Can I="update" a="Student">
              <form.AppForm>
                <form.SubmitButton
                  testId="students-detail-save-btn"
                  disabled={!isDirty || loading || student.version == null}
                  submittingLabel={t('detail.profile.saving')}
                >
                  {loading ? t('detail.profile.saving') : t('detail.profile.save')}
                </form.SubmitButton>
              </form.AppForm>
            </Can>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

// ─── TC History tab ───────────────────────────────────────────────────────

function TCHistoryTab({ studentProfileId }: { studentProfileId: string }) {
  const t = useTranslations('students');
  const { format } = useFormatDate();
  const { data, loading } = useStudentTCs(studentProfileId);

  if (loading && !data) {
    return <TabSkeleton />;
  }

  const tcs = data?.listTCs ?? [];

  if (tcs.length === 0) {
    return (
      <Empty className="py-12">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ClipboardList aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle data-testid={instituteStudents.detailTcEmpty}>
            {t('detail.tc.empty')}
          </EmptyTitle>
          <EmptyDescription>{t('detail.tc.emptyDescription')}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="space-y-3">
      {tcs.map((tc) => (
        <Card key={tc.id}>
          <CardContent className="pt-6">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm font-semibold">{tc.tcSerialNumber}</span>
                  {tc.isDuplicate && <Badge variant="outline">{t('detail.tc.duplicate')}</Badge>}
                  <Badge variant="secondary" className={TC_STATUS_CLASS[tc.status] ?? ''}>
                    {t(`detail.tc.statuses.${tc.status}`, { default: tc.status })}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground">{tc.reason}</p>
                <p className="text-xs text-muted-foreground">
                  {format(parseISO(tc.createdAt), 'dd/MM/yyyy')}
                </p>
              </div>
              {tc.pdf && (
                <span className="print:hidden">
                  <FileDownloadButton
                    fileId={tc.pdf.id}
                    scope="institute"
                    label={t('detail.tc.downloadPdf')}
                    testId={instituteStudents.detailTcDownloadBtn(tc.id)}
                  />
                </span>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ─── Audit tab ────────────────────────────────────────────────────────────

function AuditTab({ studentId }: { studentId: string }) {
  return (
    <EntityTimeline
      entityType="Student"
      entityId={studentId}
      emptyStateTestId="students-detail-audit-empty"
    />
  );
}

// ─── Academics tab ────────────────────────────────────────────────────────

type PlacementDialog = 'enrol' | 'changeClass' | 'remove' | null;

function AcademicsTab({ student }: { student: StudentDetailNode }) {
  const t = useTranslations('students');
  const { format } = useFormatDate();
  const resolveI18n = useI18nField();
  const { data, loading } = useStudentAcademics(student.id);
  const { data: yearsData } = useAcademicYearsForStudents();
  const [dialog, setDialog] = React.useState<PlacementDialog>(null);

  if (loading && !data) {
    return <TabSkeleton />;
  }

  const rows = data?.listStudentAcademics ?? [];
  const activeYear = yearsData?.academicYears.find((y) => y.isActive) ?? null;
  const activeRow = activeYear
    ? rows.find((row) => row.academicYearId === activeYear.id)
    : undefined;
  const studentName = [resolveI18n(student.firstName), resolveI18n(student.lastName)]
    .filter(Boolean)
    .join(' ');
  const closeDialog = (open: boolean) => {
    if (!open) setDialog(null);
  };

  const notPlaced = activeYear && !activeRow && (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
      <span>{t('placement.notPlacedNotice', { year: activeYear.label })}</span>
      <Can I="create" a="Student">
        <Button
          size="sm"
          onClick={() => setDialog('enrol')}
          title={t('placement.enrolButton')}
          data-testid={instituteStudents.detailEnrolBtn}
        >
          <UserPlus aria-hidden="true" className="size-4" />
          {t('placement.enrolButton')}
        </Button>
      </Can>
    </div>
  );

  const dialogs = activeYear && (
    <>
      <EnrolStudentDialog
        open={dialog === 'enrol'}
        onOpenChange={closeDialog}
        studentProfileId={student.id}
        studentName={studentName}
        academicYearId={activeYear.id}
        yearLabel={activeYear.label}
      />
      {activeRow && (
        <>
          <ChangeClassDialog
            open={dialog === 'changeClass'}
            onOpenChange={closeDialog}
            studentAcademicId={activeRow.id}
            academicYearId={activeYear.id}
            yearLabel={activeYear.label}
            currentStandardId={activeRow.standardId}
            currentSectionId={activeRow.sectionId}
          />
          <RemoveFromYearDialog
            open={dialog === 'remove'}
            onOpenChange={closeDialog}
            studentAcademicId={activeRow.id}
            yearLabel={activeYear.label}
          />
        </>
      )}
    </>
  );

  if (rows.length === 0) {
    return (
      <div className="space-y-3">
        {notPlaced}
        <Empty className="py-12">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <GraduationCap aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle data-testid={instituteStudents.detailAcademicsEmpty}>
              {t('detail.academics.empty')}
            </EmptyTitle>
            <EmptyDescription>{t('detail.academics.emptyDescription')}</EmptyDescription>
          </EmptyHeader>
        </Empty>
        {dialogs}
      </div>
    );
  }

  return (
    <Card>
      <CardContent className="pt-6 space-y-3">
        {notPlaced}
        {rows.map((row) => (
          <div
            key={row.id}
            className={`flex items-start justify-between gap-4 rounded-md border p-4 ${
              row.isCurrentYear ? 'border-emerald-300 bg-emerald-50/40' : ''
            }`}
          >
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="font-semibold">{row.academicYearLabel}</span>
                {row.isCurrentYear && (
                  <Badge variant="outline" className="border-emerald-300 text-emerald-700">
                    <CheckCircle2 aria-hidden="true" className="size-3" />
                    {t('detail.academics.currentYear')}
                  </Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                {resolveI18n(row.standardName) ?? t('detail.academics.unknownStandard')}
                {row.sectionName ? ` · ${resolveI18n(row.sectionName)}` : ''}
                {row.rollNumber ? ` · ${t('detail.academics.roll')} ${row.rollNumber}` : ''}
              </p>
              {row.promotionStatus && (
                <Badge variant="secondary" className="text-xs">
                  {t(`academicStatuses.${row.promotionStatus.toUpperCase()}`, {
                    default: row.promotionStatus,
                  })}
                </Badge>
              )}
            </div>
            <div className="flex flex-col items-end gap-2">
              <div className="text-xs text-muted-foreground">
                {format(parseISO(row.updatedAt), 'dd/MM/yyyy')}
              </div>
              {row.id === activeRow?.id && (
                <Can I="update" a="Student">
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setDialog('changeClass')}
                      title={t('placement.changeClassButton')}
                      data-testid={instituteStudents.detailChangeClassBtn}
                    >
                      <MoveRight aria-hidden="true" className="size-4" />
                      {t('placement.changeClassButton')}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-destructive"
                      onClick={() => setDialog('remove')}
                      title={t('placement.removeButton')}
                      data-testid={instituteStudents.detailRemoveFromYearBtn}
                    >
                      <UserMinus aria-hidden="true" className="size-4" />
                      {t('placement.removeButton')}
                    </Button>
                  </div>
                </Can>
              )}
            </div>
          </div>
        ))}
        {dialogs}
      </CardContent>
    </Card>
  );
}

// ─── Guardians tab ────────────────────────────────────────────────────────

function GuardiansTab({
  studentProfileId,
  studentName,
}: {
  studentProfileId: string;
  studentName: string;
}) {
  const t = useTranslations('students');
  const resolveI18n = useI18nField();
  const { data, loading } = useStudentGuardians(studentProfileId);
  const [linkDialogOpen, setLinkDialogOpen] = React.useState(false);

  if (loading && !data) {
    return <TabSkeleton />;
  }

  const guardians = data?.listStudentGuardians ?? [];
  const linkedGuardianIds = new Set(guardians.map((g) => g.guardianProfileId));
  const hasExistingPrimary = guardians.some((g) => g.isPrimaryContact);

  // Only render the CTA + dialog for users who can actually mutate the
  // link — the backend guards `linkGuardianToStudent` with `update Guardian`
  // (see docs/staff-and-guardians.md). Without this wrapper, read-only roles
  // would see a button that always throws a 403.
  const linkButton = (
    <Can I="update" a="Guardian">
      <Button
        size="sm"
        onClick={() => setLinkDialogOpen(true)}
        data-testid={instituteStudents.detailLinkGuardianBtn}
      >
        <Plus className="size-4" aria-hidden="true" />
        {t('detail.guardians.linkButton')}
      </Button>
    </Can>
  );

  const linkDialog = (
    <LinkGuardianDialog
      studentProfileId={studentProfileId}
      open={linkDialogOpen}
      onOpenChange={setLinkDialogOpen}
      excludeGuardianIds={linkedGuardianIds}
      hasExistingPrimary={hasExistingPrimary}
    />
  );

  if (guardians.length === 0) {
    return (
      <>
        <div className="mb-3 flex justify-end">{linkButton}</div>
        <Empty className="py-12">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Users aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle data-testid={instituteStudents.detailGuardiansEmpty}>
              {t('detail.guardians.empty')}
            </EmptyTitle>
            <EmptyDescription>{t('detail.guardians.emptyDescription')}</EmptyDescription>
          </EmptyHeader>
        </Empty>
        {linkDialog}
      </>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">
          {t('detail.guardians.count', { count: guardians.length })}
        </span>
        {linkButton}
      </div>
      {guardians.map((g) => {
        const fullName = [resolveI18n(g.firstName), resolveI18n(g.lastName)]
          .filter(Boolean)
          .join(' ');
        return (
          <Card key={g.linkId}>
            <CardContent className="pt-6">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <PersonNameLink kind="guardian" id={g.guardianProfileId}>
                      {fullName}
                    </PersonNameLink>
                    {g.isPrimaryContact && (
                      <Badge variant="outline" className="border-amber-300 text-amber-700">
                        <Star aria-hidden="true" className="size-3" />
                        {t('detail.guardians.primary')}
                      </Badge>
                    )}
                    {g.isEmergencyContact && (
                      <Badge variant="outline" className="border-rose-300 text-rose-700">
                        {t('detail.guardians.emergency')}
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {t(`detail.guardians.relationships.${g.relationship}`, {
                      default: g.relationship,
                    })}
                    {g.occupation ? ` · ${g.occupation}` : ''}
                    {g.organization ? ` (${g.organization})` : ''}
                  </p>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    {g.canPickup && (
                      <span className="flex items-center gap-1">
                        <CheckCircle2 aria-hidden="true" className="size-3 text-emerald-600" />
                        {t('detail.guardians.canPickup')}
                      </span>
                    )}
                    {g.livesWith && (
                      <span className="flex items-center gap-1">
                        <CheckCircle2 aria-hidden="true" className="size-3 text-emerald-600" />
                        {t('detail.guardians.livesWith')}
                      </span>
                    )}
                  </div>
                </div>
                <UnlinkGuardianButton
                  linkId={g.linkId}
                  studentProfileId={studentProfileId}
                  guardianProfileId={g.guardianProfileId}
                  studentName={studentName}
                  guardianName={fullName}
                />
              </div>
            </CardContent>
          </Card>
        );
      })}
      {linkDialog}
    </div>
  );
}

// ─── Link Guardian dialog ────────────────────────────────────────────────

interface LinkGuardianDialogProps {
  studentProfileId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  excludeGuardianIds: Set<string>;
  /** True when the student already has another guardian flagged as primary.
   *  Used to surface a demotion warning if the user toggles Primary on. */
  hasExistingPrimary: boolean;
}

function LinkGuardianDialog({
  studentProfileId,
  open,
  onOpenChange,
  excludeGuardianIds,
  hasExistingPrimary,
}: LinkGuardianDialogProps) {
  const t = useTranslations('students');
  const linkErrorMessage = useLinkErrorMessage();
  const resolveI18n = useI18nField();
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const debouncedSearch = useDebouncedValue(search, 250);
  const [guardianId, setGuardianId] = React.useState<string | null>(null);
  const [selectedGuardian, setSelectedGuardian] = React.useState<GuardianPickerNode | null>(null);
  const [relationship, setRelationship] = React.useState<GuardianRelationship | ''>('');
  const [isPrimaryContact, setIsPrimaryContact] = React.useState(false);
  const [isEmergencyContact, setIsEmergencyContact] = React.useState(false);
  const [canPickup, setCanPickup] = React.useState(true);
  const [livesWith, setLivesWith] = React.useState(true);

  // `skip: !open` so the picker query only fires once the user actually
  // opens the dialog — the component stays mounted in the tree but is
  // idle until interacted with.
  const { data, loading } = useGuardiansForStudentPicker(debouncedSearch, { skip: !open });
  const [linkMutation, { loading: linking }] = useLinkGuardianToStudent();

  const options = (data?.listGuardians ?? []).filter((g) => !excludeGuardianIds.has(g.id));

  React.useEffect(() => {
    if (!open) {
      setSearch('');
      setGuardianId(null);
      setSelectedGuardian(null);
      setRelationship('');
      setIsPrimaryContact(false);
      setIsEmergencyContact(false);
      setCanPickup(true);
      setLivesWith(true);
    }
  }, [open]);

  const canSubmit = guardianId !== null && relationship !== '' && !linking;
  const showPrimaryWarning = isPrimaryContact && hasExistingPrimary;

  async function handleSubmit() {
    if (!guardianId || !relationship) return;
    try {
      await linkMutation({
        variables: {
          input: {
            guardianProfileId: guardianId,
            studentProfileId,
            relationship,
            isPrimaryContact,
            isEmergencyContact,
            canPickup,
            livesWith,
          },
        },
      });
      toast.success(t('detail.guardians.linkDialog.linked'));
      onOpenChange(false);
    } catch (err) {
      toast.error(t('detail.guardians.linkDialog.linkFailed'), {
        description: linkErrorMessage(err),
      });
    }
  }

  const selectedLabel = selectedGuardian
    ? [resolveI18n(selectedGuardian.firstName), resolveI18n(selectedGuardian.lastName)]
        .filter(Boolean)
        .join(' ') + (selectedGuardian.primaryPhone ? ` (${selectedGuardian.primaryPhone})` : '')
    : '';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-lg"
        data-testid={instituteStudents.detailLinkGuardianDialog}
      >
        <DialogHeader>
          <DialogTitle>{t('detail.guardians.linkDialog.title')}</DialogTitle>
          <DialogDescription>{t('detail.guardians.linkDialog.description')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Field>
            <FieldLabel>{t('detail.guardians.linkDialog.guardianLabel')}</FieldLabel>
            <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  role="combobox"
                  aria-expanded={pickerOpen}
                  className="w-full justify-between font-normal"
                  data-testid={instituteStudents.detailLinkGuardianPickerTrigger}
                >
                  <span className={selectedGuardian ? '' : 'text-muted-foreground'}>
                    {selectedLabel || t('detail.guardians.linkDialog.guardianPlaceholder')}
                  </span>
                  {loading ? (
                    <Loader2 className="size-4 animate-spin opacity-50" />
                  ) : (
                    <ChevronsUpDown className="size-4 opacity-50" />
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
                <Command shouldFilter={false}>
                  <CommandInput
                    placeholder={t('detail.guardians.linkDialog.searchPlaceholder')}
                    value={search}
                    onValueChange={setSearch}
                  />
                  <CommandList>
                    <CommandEmpty>
                      {loading
                        ? t('detail.guardians.linkDialog.searchLoading')
                        : t('detail.guardians.linkDialog.searchNoResults')}
                    </CommandEmpty>
                    <CommandGroup>
                      {options.map((option) => {
                        const name = [resolveI18n(option.firstName), resolveI18n(option.lastName)]
                          .filter(Boolean)
                          .join(' ');
                        const subline = [option.primaryPhone, option.occupation]
                          .filter(Boolean)
                          .join(' · ');
                        return (
                          <CommandItem
                            key={option.id}
                            value={option.id}
                            onSelect={() => {
                              setGuardianId(option.id);
                              setSelectedGuardian(option);
                              setPickerOpen(false);
                            }}
                            data-testid={`student-detail-link-guardian-option-${option.id}`}
                          >
                            <Check
                              className={`mr-2 size-4 ${
                                guardianId === option.id ? 'opacity-100' : 'opacity-0'
                              }`}
                              aria-hidden="true"
                            />
                            <div className="flex min-w-0 flex-col">
                              <span className="truncate">{name}</span>
                              {subline && (
                                <span className="truncate text-xs text-muted-foreground">
                                  {subline}
                                </span>
                              )}
                            </div>
                          </CommandItem>
                        );
                      })}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </Field>

          <Field>
            <FieldLabel>{t('detail.guardians.linkDialog.relationshipLabel')}</FieldLabel>
            <Select
              value={relationship}
              onValueChange={(v) => setRelationship(v as GuardianRelationship)}
            >
              <SelectTrigger data-testid={instituteStudents.detailLinkGuardianRelationshipSelect}>
                <SelectValue
                  placeholder={t('detail.guardians.linkDialog.relationshipPlaceholder')}
                />
              </SelectTrigger>
              <SelectContent>
                {GUARDIAN_RELATIONSHIP_VALUES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {t(`detail.guardians.relationships.${value}`, { default: value })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <GuardianLinkToggle
              id="stud-link-is-primary"
              label={t('detail.guardians.linkDialog.isPrimaryContact')}
              checked={isPrimaryContact}
              onCheckedChange={setIsPrimaryContact}
            />
            <GuardianLinkToggle
              id="stud-link-is-emergency"
              label={t('detail.guardians.linkDialog.isEmergencyContact')}
              checked={isEmergencyContact}
              onCheckedChange={setIsEmergencyContact}
            />
            <GuardianLinkToggle
              id="stud-link-can-pickup"
              label={t('detail.guardians.linkDialog.canPickup')}
              checked={canPickup}
              onCheckedChange={setCanPickup}
            />
            <GuardianLinkToggle
              id="stud-link-lives-with"
              label={t('detail.guardians.linkDialog.livesWith')}
              checked={livesWith}
              onCheckedChange={setLivesWith}
            />
          </div>

          {showPrimaryWarning && (
            <div
              className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100"
              role="alert"
              data-testid={instituteStudents.detailLinkGuardianPrimaryWarning}
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>{t('detail.guardians.linkDialog.primaryWarning')}</span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={linking}>
            {t('detail.guardians.linkDialog.cancel')}
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!canSubmit}
            data-testid={instituteStudents.detailLinkGuardianSubmit}
          >
            {linking
              ? t('detail.guardians.linkDialog.submitting')
              : t('detail.guardians.linkDialog.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function GuardianLinkToggle({
  id,
  label,
  checked,
  onCheckedChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-md border p-3">
      <FieldLabel htmlFor={id} className="cursor-pointer">
        {label}
      </FieldLabel>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}

// ─── Documents tab ────────────────────────────────────────────────────────

function UploadDocumentDialog({
  studentProfileId,
  userId,
  open,
  onOpenChange,
}: {
  studentProfileId: string;
  userId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('students');
  const tFiles = useTranslations('fileUpload');
  const [uploadDocument, { loading }] = useUploadStudentDocument();
  const [uploading, setUploading] = useState(false);

  const documentTypeOptions = DOCUMENT_TYPES.map((dt) => ({
    value: dt,
    label: t(`detail.documents.types.${dt}`, { default: dt }),
  }));

  const form = useAppForm({
    defaultValues: {
      type: 'BIRTH_CERTIFICATE' as (typeof DOCUMENT_TYPES)[number],
      description: '',
      fileIds: [] as string[],
      referenceNumber: '',
    } satisfies UploadDocumentFormValues,
    validators: {
      onChange: zodValidator(uploadDocumentSchema),
      onSubmit: zodValidator(uploadDocumentSchema),
    },
    onSubmit: async ({ value }) => {
      const parsed = uploadDocumentSchema.parse(value);
      try {
        await uploadDocument({
          variables: {
            input: {
              studentProfileId,
              type: parsed.type,
              description: parsed.description,
              fileIds: parsed.fileIds,
              referenceNumber: parsed.referenceNumber,
            },
          },
        });
        toast.success(t('detail.documents.upload.success'));
        onOpenChange(false);
      } catch (err) {
        const fileError = fileUploadErrorKey(extractGraphQLErrorCode(err));
        toast.error(
          fileError
            ? tFiles(`errors.${fileError}`, { count: MAX_DOCUMENT_FILES })
            : t('detail.documents.upload.error'),
        );
      }
    },
  });

  React.useEffect(() => {
    if (!open) form.reset();
  }, [open, form]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('detail.documents.upload.dialogTitle')}</DialogTitle>
          <DialogDescription>{t('detail.documents.upload.dialogDescription')}</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void form.handleSubmit();
          }}
          noValidate
          className="space-y-4"
        >
          <FieldGroup>
            <form.AppField name="type">
              {(field) => (
                <field.SelectField
                  label={t('detail.documents.upload.typeLabel')}
                  options={documentTypeOptions}
                  optional={false}
                  testId="students-detail-upload-doc-type-select"
                />
              )}
            </form.AppField>
            <form.AppField name="description">
              {(field) => (
                <field.TextareaField
                  label={t('detail.documents.upload.descriptionLabel')}
                  placeholder={t('detail.documents.upload.descriptionPlaceholder')}
                  rows={2}
                  testId="students-detail-upload-doc-description-input"
                  errorTestId="students-detail-upload-doc-description-error"
                />
              )}
            </form.AppField>
            <form.Field name="fileIds">
              {(field) => (
                <FileUpload
                  // Remounted with the dialog so a closed dialog forgets its uploads.
                  key={String(open)}
                  name="student-document"
                  purpose="USER_DOCUMENT"
                  subjectUserId={userId}
                  label={t('detail.documents.upload.filesLabel')}
                  description={t('detail.documents.upload.filesHint')}
                  maxFiles={MAX_DOCUMENT_FILES}
                  onChange={(fileIds) => field.handleChange(fileIds)}
                  onBusyChange={setUploading}
                />
              )}
            </form.Field>
            <form.AppField name="referenceNumber">
              {(field) => (
                <field.TextField
                  label={t('detail.documents.upload.referenceNumberLabel')}
                  placeholder={t('detail.documents.upload.referenceNumberPlaceholder')}
                  testId="students-detail-upload-doc-ref-input"
                  errorTestId="students-detail-upload-doc-ref-error"
                />
              )}
            </form.AppField>
          </FieldGroup>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              data-testid={instituteStudents.detailUploadDocCancelBtn}
            >
              {t('detail.documents.upload.cancel')}
            </Button>
            <form.AppForm>
              <form.SubmitButton
                disabled={loading || uploading}
                submittingLabel={t('detail.documents.upload.submitting')}
                testId="students-detail-upload-doc-submit-btn"
              >
                {loading
                  ? t('detail.documents.upload.submitting')
                  : t('detail.documents.upload.submitLabel')}
              </form.SubmitButton>
            </form.AppForm>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DocumentsTab({
  studentProfileId,
  userId,
}: {
  studentProfileId: string;
  /** Null when the caller may not read it; documents can then be viewed but not added. */
  userId: string | null;
}) {
  const t = useTranslations('students');
  const { format } = useFormatDate();
  const { data, loading } = useStudentDocuments(studentProfileId);
  const [uploadOpen, setUploadOpen] = useState(false);

  if (loading && !data) {
    return <TabSkeleton />;
  }

  const docs = data?.listStudentDocuments ?? [];

  const header = userId && (
    <Can I="update" a="Student">
      <div className="flex justify-end">
        <Button
          type="button"
          size="sm"
          onClick={() => setUploadOpen(true)}
          data-testid={instituteStudents.detailUploadDocBtn}
        >
          <FileText aria-hidden="true" className="size-4" />
          {t('detail.documents.upload.uploadButton')}
        </Button>
      </div>
    </Can>
  );

  if (docs.length === 0) {
    return (
      <div className="space-y-3">
        {header}
        <Empty className="py-12">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FileText aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle data-testid={instituteStudents.detailDocumentsEmpty}>
              {t('detail.documents.empty')}
            </EmptyTitle>
            <EmptyDescription>{t('detail.documents.emptyDescription')}</EmptyDescription>
          </EmptyHeader>
        </Empty>
        {userId && (
          <UploadDocumentDialog
            studentProfileId={studentProfileId}
            userId={userId}
            open={uploadOpen}
            onOpenChange={setUploadOpen}
          />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {header}
      {docs.map((doc) => (
        <Card key={doc.id}>
          <CardContent className="pt-6">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">
                    {t(`detail.documents.types.${doc.type}`, { default: doc.type })}
                  </span>
                  {doc.isVerified ? (
                    <Badge variant="outline" className="border-emerald-300 text-emerald-700">
                      <CheckCircle2 aria-hidden="true" className="size-3" />
                      {t('detail.documents.verified')}
                    </Badge>
                  ) : doc.rejectionReason ? (
                    <Badge variant="outline" className="border-rose-300 text-rose-700">
                      <XCircle aria-hidden="true" className="size-3" />
                      {t('detail.documents.rejected')}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="border-amber-300 text-amber-700">
                      {t('detail.documents.pending')}
                    </Badge>
                  )}
                </div>
                {doc.description && (
                  <p className="text-sm text-muted-foreground">{doc.description}</p>
                )}
                {doc.referenceNumber && (
                  <p className="text-xs font-mono text-muted-foreground">
                    {t('detail.documents.refNo')}: {doc.referenceNumber}
                  </p>
                )}
                {doc.rejectionReason && (
                  <p className="text-xs text-rose-700">{doc.rejectionReason}</p>
                )}
                <p className="text-xs text-muted-foreground">
                  {format(parseISO(doc.createdAt), 'dd/MM/yyyy')}
                  {doc.expiryDate
                    ? ` · ${t('detail.documents.expires')} ${format(parseISO(doc.expiryDate), 'dd/MM/yyyy')}`
                    : ''}
                </p>
              </div>
              <div className="flex flex-col items-end gap-1 print:hidden">
                {doc.files.map((file, idx) => (
                  <FileDownloadButton
                    key={file.id}
                    fileId={file.id}
                    scope="institute"
                    testId={instituteStudents.detailDocumentFileBtn(file.id)}
                    label={
                      doc.files.length > 1
                        ? t('detail.documents.page', { n: idx + 1 })
                        : t('detail.documents.download')
                    }
                  />
                ))}
                <RemoveDocumentButton documentId={doc.id} type={doc.type} />
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
      {userId && (
        <UploadDocumentDialog
          studentProfileId={studentProfileId}
          userId={userId}
          open={uploadOpen}
          onOpenChange={setUploadOpen}
        />
      )}
    </div>
  );
}

// ─── Skeletons ────────────────────────────────────────────────────────────

function StudentDetailSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-24" />
      <div className="space-y-2">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-48" />
      </div>
      <Skeleton className="h-10 w-full max-w-md" />
      <Card>
        <CardContent className="pt-6 space-y-4">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </CardContent>
      </Card>
    </div>
  );
}

function TabSkeleton() {
  return (
    <div className="space-y-3">
      {[1, 2, 3].map((i) => (
        <Card key={i}>
          <CardContent className="pt-6">
            <Skeleton className="h-4 w-1/2" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ─── Attendance tab ──────────────────────────────────────────────────────

/**
 * Status chip colours mirror the main attendance page and the attendance
 * history page so the visual language (green = present, rose = absent,
 * amber = leave, sky = late) stays consistent across the app.
 */
const ATTENDANCE_STATUS_COLORS: Record<AttendanceStatus, string> = {
  PRESENT: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  ABSENT: 'bg-rose-100 text-rose-700 border-rose-200',
  LEAVE: 'bg-amber-100 text-amber-700 border-amber-200',
  LATE: 'bg-sky-100 text-sky-700 border-sky-200',
};

const ATTENDANCE_STATUS_ORDER: AttendanceStatus[] = ['PRESENT', 'ABSENT', 'LEAVE', 'LATE'];

function todayIso(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function daysAgoIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// Split the ISO YYYY-MM-DD manually instead of `new Date(iso)` — avoids
// the UTC-midnight parse drifting by a day in +05:30 when displayed.
function parseIsoDateLocal(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

interface StudentAttendanceRow extends StudentHistoryItem {
  key: string;
}

/**
 * Attendance tab body — shows the student's attendance history for a
 * date range (defaults to the last 60 days) with a summary strip and a
 * DataTable. Uses the same `useStudentHistory` hook as the dedicated
 * attendance history page so the data stays in sync.
 *
 * Dates are persisted in the URL via nuqs so deep-linking a range is
 * possible and sharing the tab doesn't lose the filter.
 */
function StudentAttendanceTab({ membershipId }: { membershipId: string }) {
  const t = useTranslations('students');
  const { format } = useFormatDate();
  const params = useParams<{ locale: string }>();
  const locale = params.locale;

  // In the popup the range stays local: writing it to the URL would change the host page.
  const { embedded } = usePersonDetailContext();
  const [urlStart, setUrlStart] = useQueryState(
    'startDate',
    parseAsString.withDefault(daysAgoIso(60)),
  );
  const [urlEnd, setUrlEnd] = useQueryState('endDate', parseAsString.withDefault(todayIso()));
  const [localStart, setLocalStart] = useState(daysAgoIso(60));
  const [localEnd, setLocalEnd] = useState(todayIso());
  const startDate = embedded ? localStart : urlStart;
  const endDate = embedded ? localEnd : urlEnd;
  const setStartDate = (v: string) => (embedded ? setLocalStart(v) : void setUrlStart(v));
  const setEndDate = (v: string) => (embedded ? setLocalEnd(v) : void setUrlEnd(v));

  const { rows, loading } = useStudentHistory(membershipId, startDate, endDate);

  const tableRows: StudentAttendanceRow[] = React.useMemo(
    () => rows.map((r) => ({ ...r, key: `${r.sessionId}-${r.date}-${r.period ?? 'day'}` })),
    [rows],
  );

  const totals = React.useMemo(() => {
    const counts: Record<AttendanceStatus, number> = {
      PRESENT: 0,
      ABSENT: 0,
      LEAVE: 0,
      LATE: 0,
    };
    for (const r of rows) counts[r.status] += 1;
    return counts;
  }, [rows]);

  const columnHelper = createColumnHelper<StudentAttendanceRow>();
  const columns: ColumnDef<StudentAttendanceRow, unknown>[] = [
    columnHelper.accessor('date', {
      header: t('detail.attendanceTab.date'),
      cell: ({ getValue, row }) => (
        <span
          className="font-medium tabular-nums"
          data-testid={`student-attendance-row-${row.original.sessionId}-date`}
        >
          {format(parseIsoDateLocal(getValue()), 'dd MMM yyyy')}
        </span>
      ),
    }) as ColumnDef<StudentAttendanceRow, unknown>,
    columnHelper.accessor('period', {
      header: t('detail.attendanceTab.period'),
      cell: ({ getValue }) => {
        const p = getValue();
        return (
          <span className="tabular-nums">
            {p === null
              ? t('detail.attendanceTab.wholeDay')
              : `${t('detail.attendanceTab.period')} ${p}`}
          </span>
        );
      },
    }) as ColumnDef<StudentAttendanceRow, unknown>,
    columnHelper.accessor('subjectId', {
      header: t('detail.attendanceTab.subject'),
      cell: ({ getValue }) => <span className="text-muted-foreground">{getValue() ?? '—'}</span>,
    }) as ColumnDef<StudentAttendanceRow, unknown>,
    columnHelper.accessor('status', {
      header: t('detail.attendanceTab.status'),
      cell: ({ getValue, row }) => {
        const status = getValue();
        return (
          <Badge
            variant="outline"
            className={ATTENDANCE_STATUS_COLORS[status]}
            data-testid={`student-attendance-row-${row.original.sessionId}-status`}
          >
            {t(`detail.attendanceTab.summary.${status}` as const)}
          </Badge>
        );
      },
    }) as ColumnDef<StudentAttendanceRow, unknown>,
    columnHelper.accessor('remarks', {
      header: t('detail.attendanceTab.remarks'),
      cell: ({ getValue }) => {
        const r = getValue();
        return r ? (
          <span className="text-sm text-muted-foreground">{r}</span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        );
      },
    }) as ColumnDef<StudentAttendanceRow, unknown>,
  ];

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 flex-1 min-w-[280px]">
              <div>
                <span className="text-xs font-medium text-muted-foreground mb-1 block">
                  {t('detail.attendanceTab.from')}
                </span>
                <Input
                  type="date"
                  value={startDate}
                  onChange={(e) => void setStartDate(e.target.value || daysAgoIso(60))}
                  data-testid={instituteStudents.attendanceStartDateInput}
                />
              </div>
              <div>
                <span className="text-xs font-medium text-muted-foreground mb-1 block">
                  {t('detail.attendanceTab.to')}
                </span>
                <Input
                  type="date"
                  value={endDate}
                  onChange={(e) => void setEndDate(e.target.value || todayIso())}
                  data-testid={instituteStudents.attendanceEndDateInput}
                />
              </div>
            </div>
            <Button
              asChild
              variant="outline"
              size="sm"
              className="gap-2"
              data-testid={instituteStudents.attendanceViewFullLink}
            >
              <Link
                href={`/${locale}/institute/attendance/history?studentId=${membershipId}&startDate=${startDate}&endDate=${endDate}`}
              >
                <ClipboardList aria-hidden="true" className="size-4" />
                {t('detail.attendanceTab.viewFull')}
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      <div
        className="flex flex-wrap items-center gap-2"
        data-testid={instituteStudents.attendanceSummary}
      >
        {ATTENDANCE_STATUS_ORDER.map((s) => (
          <Badge
            key={s}
            variant="outline"
            className={`${ATTENDANCE_STATUS_COLORS[s]} border-0`}
            data-testid={`student-attendance-summary-${s}`}
          >
            {t(`detail.attendanceTab.summary.${s}` as const)}: {totals[s]}
          </Badge>
        ))}
      </div>

      {rows.length === 0 && !loading ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CalendarCheck aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>{t('detail.attendanceTab.noHistory')}</EmptyTitle>
          </EmptyHeader>
        </Empty>
      ) : (
        <DataTable
          columns={columns}
          data={tableRows}
          isLoading={loading}
          skeletonRows={5}
          data-testid={instituteStudents.attendanceTable}
        />
      )}
    </div>
  );
}
