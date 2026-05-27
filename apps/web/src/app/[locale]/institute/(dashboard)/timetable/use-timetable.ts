'use client';

/**
 * Apollo hooks for the timetable feature (list + single + grid editor +
 * section/staff views + day schedule + overrides).
 *
 * NOTE (codegen): the backend GraphQL schema for timetable is being built in
 * parallel and is not live yet, so these operations are NOT yet covered by
 * `pnpm codegen`. Result/variable types are hand-written below and mirror the
 * agreed contract. Once the backend lands and codegen runs, swap the local
 * interfaces for the generated `*Model` types from `@roviq/graphql/generated`
 * (same shape) — the `gql` documents and hook signatures stay identical.
 *
 * i18n: `name` fields come back as raw `i18nText` JSONB — resolve with
 * `useI18nField()` at the render site, never here.
 */
import { gql, useLazyQuery, useMutation, useQuery } from '@roviq/graphql';
import type { I18nText } from '@roviq/i18n';

// ── Enum unions (mirror @roviq/common-types value arrays) ───────────────

export type TimetableStatus = 'DRAFT' | 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
export type Weekday =
  | 'MONDAY'
  | 'TUESDAY'
  | 'WEDNESDAY'
  | 'THURSDAY'
  | 'FRIDAY'
  | 'SATURDAY'
  | 'SUNDAY';
export type PeriodKind = 'PERIOD' | 'BREAK' | 'EXTRA';
export type DaySession = 'MORNING' | 'MAIN' | 'EVENING';
export type TimetableOverrideType =
  | 'SUBSTITUTION'
  | 'CANCELLATION'
  | 'ROOM_CHANGE'
  | 'SUBJECT_CHANGE'
  | 'EXTRA';

// ── Entity shapes ───────────────────────────────────────────────────────

export interface TimetableListItem {
  id: string;
  name: I18nText;
  description: string | null;
  status: TimetableStatus;
  effectiveFrom: string;
  effectiveTo: string;
  workingDays: Weekday[];
}

export interface TimetablePeriod {
  id: string;
  kind: PeriodKind;
  label: string;
  sequence: number;
  startTime: string;
  endTime: string;
  session: DaySession;
}

export interface TimetableSectionLink {
  id: string;
  sectionId: string;
}

export interface Timetable {
  id: string;
  academicYearId: string;
  name: I18nText;
  description: string | null;
  status: TimetableStatus;
  effectiveFrom: string;
  effectiveTo: string;
  workingDays: Weekday[];
  dayStartTime: string;
  defaultPeriodDurationMins: number;
  sections: TimetableSectionLink[];
  periods: TimetablePeriod[];
}

export interface TimetableStatistics {
  total: number;
  draft: number;
  active: number;
  inactive: number;
  archived: number;
}

export interface GridEntry {
  id: string;
  periodId: string;
  sectionId: string;
  dayOfWeek: Weekday;
  splitIndex: number;
  splitLabel: string | null;
  subjectId: string | null;
  teacherId: string | null;
  room: string | null;
}

export interface SectionTimetableGrid {
  timetableId: string;
  periods: Array<Omit<TimetablePeriod, 'session'>>;
  workingDays: Weekday[];
  entries: GridEntry[];
}

export interface DayScheduleSlot {
  periodId: string;
  label: string;
  kind: PeriodKind;
  startTime: string;
  endTime: string;
  splitIndex: number;
  splitLabel: string | null;
  sectionId: string;
  subjectId: string | null;
  teacherId: string | null;
  room: string | null;
  isOverride: boolean;
  overrideType: TimetableOverrideType | null;
}

export interface DaySchedule {
  date: string;
  dayOfWeek: Weekday;
  sectionId: string;
  timetableId: string | null;
  slots: DayScheduleSlot[];
}

export interface TimetableDayOverride {
  id: string;
  date: string;
  sectionId: string;
  periodId: string;
  splitIndex: number;
  overrideType: TimetableOverrideType;
  subjectId: string | null;
  teacherId: string | null;
  room: string | null;
  reason: string | null;
}

export interface PaginatedTimetables {
  docs: TimetableListItem[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}

// ── Input shapes ────────────────────────────────────────────────────────

export interface LunchInput {
  name: string;
  afterPeriod: number;
  durationMins: number;
}

export interface ExtraClassInput {
  session: DaySession;
  startTime: string;
  durationMins: number;
  count: number;
}

export interface CreateTimetableInput {
  name: I18nText;
  description?: string | null;
  academicYearId: string;
  sectionIds: string[];
  effectiveFrom: string;
  effectiveTo: string;
  dayStartTime: string;
  defaultPeriodDurationMins: number;
  periodsCount: number;
  workingDays: Weekday[];
  lunch?: LunchInput[];
  extraClass?: ExtraClassInput[];
}

export interface UpdateTimetableInput {
  name?: I18nText;
  description?: string | null;
  effectiveFrom?: string;
  effectiveTo?: string;
  workingDays?: Weekday[];
}

export interface AssignSplitInput {
  splitIndex: number;
  splitLabel?: string | null;
  subjectId?: string | null;
  teacherId?: string | null;
  room?: string | null;
}

export interface AssignTimetableEntryInput {
  timetableId: string;
  sectionId: string;
  periodId: string;
  days: Array<{ dayOfWeek: Weekday }>;
  splits: AssignSplitInput[];
}

export interface CreateTimetableDayOverrideInput {
  timetableId: string;
  date: string;
  sectionId: string;
  periodId: string;
  splitIndex: number;
  overrideType: TimetableOverrideType;
  subjectId?: string | null;
  teacherId?: string | null;
  room?: string | null;
  reason?: string | null;
}

// ── Documents ───────────────────────────────────────────────────────────

const TIMETABLES_QUERY = gql`
  query Timetables(
    $academicYearId: ID!
    $status: TimetableStatus
    $sectionId: ID
    $search: String
    $page: Int
    $perPage: Int
  ) {
    timetables(
      academicYearId: $academicYearId
      status: $status
      sectionId: $sectionId
      search: $search
      page: $page
      perPage: $perPage
    ) {
      docs {
        id
        name
        description
        status
        effectiveFrom
        effectiveTo
        workingDays
      }
      total
      page
      perPage
      totalPages
    }
  }
`;

const TIMETABLE_QUERY = gql`
  query Timetable($id: ID!) {
    timetable(id: $id) {
      id
      academicYearId
      name
      description
      status
      effectiveFrom
      effectiveTo
      workingDays
      dayStartTime
      defaultPeriodDurationMins
      sections {
        id
        sectionId
      }
      periods {
        id
        kind
        label
        sequence
        startTime
        endTime
        session
      }
    }
  }
`;

const TIMETABLE_STATISTICS_QUERY = gql`
  query TimetableStatistics($academicYearId: ID) {
    timetableStatistics(academicYearId: $academicYearId) {
      total
      draft
      active
      inactive
      archived
    }
  }
`;

const SECTION_TIMETABLE_QUERY = gql`
  query SectionTimetable($sectionId: ID!, $timetableId: ID) {
    sectionTimetable(sectionId: $sectionId, timetableId: $timetableId) {
      timetableId
      periods {
        id
        kind
        label
        sequence
        startTime
        endTime
      }
      workingDays
      entries {
        id
        periodId
        sectionId
        dayOfWeek
        splitIndex
        splitLabel
        subjectId
        teacherId
        room
      }
    }
  }
`;

const STAFF_TIMETABLE_QUERY = gql`
  query StaffTimetable($teacherId: ID!, $timetableId: ID) {
    staffTimetable(teacherId: $teacherId, timetableId: $timetableId) {
      timetableId
      periods {
        id
        kind
        label
        sequence
        startTime
        endTime
      }
      workingDays
      entries {
        id
        periodId
        sectionId
        dayOfWeek
        splitIndex
        splitLabel
        subjectId
        teacherId
        room
      }
    }
  }
`;

const SECTION_TIMETABLE_PDF_QUERY = gql`
  query SectionTimetablePdf($sectionId: ID!, $timetableId: ID) {
    sectionTimetablePdf(sectionId: $sectionId, timetableId: $timetableId)
  }
`;

const STAFF_TIMETABLE_PDF_QUERY = gql`
  query StaffTimetablePdf($teacherId: ID!, $timetableId: ID) {
    staffTimetablePdf(teacherId: $teacherId, timetableId: $timetableId)
  }
`;

const TIMETABLE_DAY_SCHEDULE_QUERY = gql`
  query TimetableDaySchedule($date: String!, $sectionId: ID!) {
    timetableDaySchedule(date: $date, sectionId: $sectionId) {
      date
      dayOfWeek
      sectionId
      timetableId
      slots {
        periodId
        label
        kind
        startTime
        endTime
        splitIndex
        splitLabel
        sectionId
        subjectId
        teacherId
        room
        isOverride
        overrideType
      }
    }
  }
`;

const STAFF_DAY_SCHEDULE_QUERY = gql`
  query StaffDaySchedule($date: String!, $teacherId: ID!) {
    staffDaySchedule(date: $date, teacherId: $teacherId) {
      periodId
      label
      kind
      startTime
      endTime
      splitIndex
      splitLabel
      sectionId
      subjectId
      teacherId
      room
      isOverride
      overrideType
    }
  }
`;

const TIMETABLE_DAY_OVERRIDES_QUERY = gql`
  query TimetableDayOverrides($timetableId: ID!, $date: String!) {
    timetableDayOverrides(timetableId: $timetableId, date: $date) {
      id
      date
      sectionId
      periodId
      splitIndex
      overrideType
      subjectId
      teacherId
      room
      reason
    }
  }
`;

const CREATE_TIMETABLE = gql`
  mutation CreateTimetable($input: CreateTimetableInput!) {
    createTimetable(input: $input) {
      id
    }
  }
`;

const UPDATE_TIMETABLE = gql`
  mutation UpdateTimetable($id: ID!, $input: UpdateTimetableInput!) {
    updateTimetable(id: $id, input: $input) {
      id
    }
  }
`;

const ACTIVATE_TIMETABLE = gql`
  mutation ActivateTimetable($id: ID!) {
    activateTimetable(id: $id) {
      id
      status
    }
  }
`;

const DEACTIVATE_TIMETABLE = gql`
  mutation DeactivateTimetable($id: ID!) {
    deactivateTimetable(id: $id) {
      id
      status
    }
  }
`;

const ARCHIVE_TIMETABLE = gql`
  mutation ArchiveTimetable($id: ID!) {
    archiveTimetable(id: $id) {
      id
      status
    }
  }
`;

const DELETE_TIMETABLE = gql`
  mutation DeleteTimetable($ids: [ID!]!) {
    deleteTimetable(ids: $ids)
  }
`;

const RESTORE_TIMETABLE = gql`
  mutation RestoreTimetable($ids: [ID!]!) {
    restoreTimetable(ids: $ids)
  }
`;

const ADD_TIMETABLE_SECTION = gql`
  mutation AddTimetableSection($timetableId: ID!, $sectionId: ID!) {
    addTimetableSection(timetableId: $timetableId, sectionId: $sectionId) {
      id
    }
  }
`;

const REMOVE_TIMETABLE_SECTION = gql`
  mutation RemoveTimetableSection($timetableId: ID!, $sectionId: ID!) {
    removeTimetableSection(timetableId: $timetableId, sectionId: $sectionId)
  }
`;

const ADD_TIMETABLE_PERIOD = gql`
  mutation AddTimetablePeriod($input: AddTimetablePeriodInput!) {
    addTimetablePeriod(input: $input) {
      id
    }
  }
`;

const UPDATE_TIMETABLE_PERIOD = gql`
  mutation UpdateTimetablePeriod($timetableId: ID!, $periodId: ID!, $input: UpdateTimetablePeriodInput!) {
    updateTimetablePeriod(timetableId: $timetableId, periodId: $periodId, input: $input) {
      id
    }
  }
`;

const REMOVE_TIMETABLE_PERIOD = gql`
  mutation RemoveTimetablePeriod($timetableId: ID!, $periodId: ID!) {
    removeTimetablePeriod(timetableId: $timetableId, periodId: $periodId)
  }
`;

const ASSIGN_TIMETABLE_ENTRY = gql`
  mutation AssignTimetableEntry($input: AssignTimetableEntryInput!) {
    assignTimetableEntry(input: $input) {
      id
    }
  }
`;

const CLEAR_TIMETABLE_ENTRY = gql`
  mutation ClearTimetableEntry($input: ClearTimetableEntryInput!) {
    clearTimetableEntry(input: $input)
  }
`;

const CREATE_TIMETABLE_DAY_OVERRIDE = gql`
  mutation CreateTimetableDayOverride($input: CreateTimetableDayOverrideInput!) {
    createTimetableDayOverride(input: $input) {
      id
    }
  }
`;

const CLEAR_TIMETABLE_DAY_OVERRIDE = gql`
  mutation ClearTimetableDayOverride($id: ID!) {
    clearTimetableDayOverride(id: $id)
  }
`;

// ── Query hooks ─────────────────────────────────────────────────────────

export function useTimetables(
  academicYearId: string | null,
  opts: {
    status?: TimetableStatus | null;
    sectionId?: string | null;
    search?: string | null;
    page?: number;
    perPage?: number;
  } = {},
) {
  const { data, loading, error, refetch } = useQuery<{ timetables: PaginatedTimetables }>(
    TIMETABLES_QUERY,
    {
      variables: {
        academicYearId,
        status: opts.status ?? null,
        sectionId: opts.sectionId ?? null,
        search: opts.search ?? null,
        page: opts.page ?? 1,
        perPage: opts.perPage ?? 20,
      },
      skip: !academicYearId,
      notifyOnNetworkStatusChange: true,
    },
  );
  return {
    timetables: data?.timetables.docs ?? [],
    total: data?.timetables.total ?? 0,
    page: data?.timetables.page ?? 1,
    perPage: data?.timetables.perPage ?? 20,
    totalPages: data?.timetables.totalPages ?? 1,
    loading,
    error,
    refetch,
  };
}

export function useTimetable(id: string | null) {
  const { data, loading, error, refetch } = useQuery<{ timetable: Timetable }>(TIMETABLE_QUERY, {
    variables: { id },
    skip: !id,
  });
  return { timetable: data?.timetable ?? null, loading, error, refetch };
}

export function useTimetableStatistics(academicYearId: string | null) {
  const { data, loading } = useQuery<{ timetableStatistics: TimetableStatistics }>(
    TIMETABLE_STATISTICS_QUERY,
    { variables: { academicYearId }, skip: !academicYearId },
  );
  return { stats: data?.timetableStatistics ?? null, loading };
}

export function useSectionTimetable(sectionId: string | null, timetableId?: string | null) {
  const { data, loading, error, refetch } = useQuery<{ sectionTimetable: SectionTimetableGrid }>(
    SECTION_TIMETABLE_QUERY,
    { variables: { sectionId, timetableId: timetableId ?? null }, skip: !sectionId },
  );
  return { grid: data?.sectionTimetable ?? null, loading, error, refetch };
}

export function useStaffTimetable(teacherId: string | null, timetableId?: string | null) {
  const { data, loading, error, refetch } = useQuery<{ staffTimetable: SectionTimetableGrid }>(
    STAFF_TIMETABLE_QUERY,
    { variables: { teacherId, timetableId: timetableId ?? null }, skip: !teacherId },
  );
  return { grid: data?.staffTimetable ?? null, loading, error, refetch };
}

/** On-demand fetch of a section timetable PDF (base64). Returns Apollo lazy tuple. */
export function useSectionTimetablePdf() {
  return useLazyQuery<
    { sectionTimetablePdf: string },
    { sectionId: string; timetableId?: string | null }
  >(SECTION_TIMETABLE_PDF_QUERY);
}

/** On-demand fetch of a staff timetable PDF (base64). Returns Apollo lazy tuple. */
export function useStaffTimetablePdf() {
  return useLazyQuery<
    { staffTimetablePdf: string },
    { teacherId: string; timetableId?: string | null }
  >(STAFF_TIMETABLE_PDF_QUERY);
}

export function useTimetableDaySchedule(date: string | null, sectionId: string | null) {
  const { data, loading, error, refetch } = useQuery<{ timetableDaySchedule: DaySchedule }>(
    TIMETABLE_DAY_SCHEDULE_QUERY,
    { variables: { date, sectionId }, skip: !date || !sectionId },
  );
  return { schedule: data?.timetableDaySchedule ?? null, loading, error, refetch };
}

export function useStaffDaySchedule(date: string | null, teacherId: string | null) {
  const { data, loading, error, refetch } = useQuery<{ staffDaySchedule: DayScheduleSlot[] }>(
    STAFF_DAY_SCHEDULE_QUERY,
    { variables: { date, teacherId }, skip: !date || !teacherId },
  );
  return { slots: data?.staffDaySchedule ?? [], loading, error, refetch };
}

export function useTimetableDayOverrides(timetableId: string | null, date: string | null) {
  const { data, loading, refetch } = useQuery<{ timetableDayOverrides: TimetableDayOverride[] }>(
    TIMETABLE_DAY_OVERRIDES_QUERY,
    { variables: { timetableId, date }, skip: !timetableId || !date },
  );
  return { overrides: data?.timetableDayOverrides ?? [], loading, refetch };
}

// ── Mutation hooks ──────────────────────────────────────────────────────

export function useCreateTimetable() {
  const [mutate, { loading }] = useMutation(CREATE_TIMETABLE, {
    refetchQueries: ['Timetables', 'TimetableStatistics'],
  });
  return {
    createTimetable: (input: CreateTimetableInput) => mutate({ variables: { input } }),
    loading,
  };
}

export function useUpdateTimetable() {
  const [mutate, { loading }] = useMutation(UPDATE_TIMETABLE, {
    refetchQueries: ['Timetables', 'Timetable'],
  });
  return {
    updateTimetable: (id: string, input: UpdateTimetableInput) =>
      mutate({ variables: { id, input } }),
    loading,
  };
}

export function useUpdateTimetableStatus() {
  const refetchQueries = ['Timetables', 'Timetable', 'TimetableStatistics'];
  const [activate, { loading: activating }] = useMutation(ACTIVATE_TIMETABLE, { refetchQueries });
  const [deactivate, { loading: deactivating }] = useMutation(DEACTIVATE_TIMETABLE, {
    refetchQueries,
  });
  const [archive, { loading: archiving }] = useMutation(ARCHIVE_TIMETABLE, { refetchQueries });
  return {
    // Named domain transitions (ROV-249): no raw status setter.
    updateStatus: (id: string, status: TimetableStatus) => {
      if (status === 'ACTIVE') return activate({ variables: { id } });
      if (status === 'ARCHIVED') return archive({ variables: { id } });
      return deactivate({ variables: { id } });
    },
    activate: (id: string) => activate({ variables: { id } }),
    deactivate: (id: string) => deactivate({ variables: { id } }),
    archive: (id: string) => archive({ variables: { id } }),
    loading: activating || deactivating || archiving,
  };
}

export function useDeleteTimetable() {
  const [mutate, { loading }] = useMutation(DELETE_TIMETABLE, {
    refetchQueries: ['Timetables', 'TimetableStatistics'],
  });
  return {
    deleteTimetable: (ids: string[]) => mutate({ variables: { ids } }),
    loading,
  };
}

export function useRestoreTimetable() {
  const [mutate, { loading }] = useMutation(RESTORE_TIMETABLE, {
    refetchQueries: ['Timetables', 'TimetableStatistics'],
  });
  return {
    restoreTimetable: (ids: string[]) => mutate({ variables: { ids } }),
    loading,
  };
}

export function useAddTimetableSection() {
  const [mutate, { loading }] = useMutation(ADD_TIMETABLE_SECTION, {
    refetchQueries: ['Timetable'],
  });
  return {
    addSection: (timetableId: string, sectionId: string) =>
      mutate({ variables: { timetableId, sectionId } }),
    loading,
  };
}

export function useRemoveTimetableSection() {
  const [mutate, { loading }] = useMutation(REMOVE_TIMETABLE_SECTION, {
    refetchQueries: ['Timetable'],
  });
  return {
    removeSection: (timetableId: string, sectionId: string) =>
      mutate({ variables: { timetableId, sectionId } }),
    loading,
  };
}

export function useAddTimetablePeriod() {
  const [mutate, { loading }] = useMutation(ADD_TIMETABLE_PERIOD, {
    refetchQueries: ['Timetable', 'SectionTimetable'],
  });
  return {
    addPeriod: (input: {
      timetableId: string;
      kind: PeriodKind;
      label?: string | null;
      durationMins?: number | null;
      startTime?: string | null;
      session?: DaySession | null;
    }) => mutate({ variables: { input } }),
    loading,
  };
}

export function useUpdateTimetablePeriod() {
  const [mutate, { loading }] = useMutation(UPDATE_TIMETABLE_PERIOD, {
    refetchQueries: ['Timetable', 'SectionTimetable'],
  });
  return {
    updatePeriod: (
      timetableId: string,
      periodId: string,
      input: { label?: string | null; startTime?: string | null; durationMins?: number | null },
    ) => mutate({ variables: { timetableId, periodId, input } }),
    loading,
  };
}

export function useRemoveTimetablePeriod() {
  const [mutate, { loading }] = useMutation(REMOVE_TIMETABLE_PERIOD, {
    refetchQueries: ['Timetable', 'SectionTimetable'],
  });
  return {
    removePeriod: (timetableId: string, periodId: string) =>
      mutate({ variables: { timetableId, periodId } }),
    loading,
  };
}

export function useAssignTimetableEntry() {
  const [mutate, { loading }] = useMutation(ASSIGN_TIMETABLE_ENTRY, {
    refetchQueries: ['SectionTimetable', 'StaffTimetable'],
  });
  return {
    assignEntry: (input: AssignTimetableEntryInput) => mutate({ variables: { input } }),
    loading,
  };
}

export function useClearTimetableEntry() {
  const [mutate, { loading }] = useMutation(CLEAR_TIMETABLE_ENTRY, {
    refetchQueries: ['SectionTimetable', 'StaffTimetable'],
  });
  return {
    clearEntry: (input: {
      timetableId: string;
      sectionId: string;
      periodId: string;
      dayOfWeek: Weekday;
      splitIndex: number;
    }) => mutate({ variables: { input } }),
    loading,
  };
}

export function useCreateTimetableDayOverride() {
  const [mutate, { loading }] = useMutation(CREATE_TIMETABLE_DAY_OVERRIDE, {
    refetchQueries: ['TimetableDaySchedule', 'StaffDaySchedule', 'TimetableDayOverrides'],
  });
  return {
    createOverride: (input: CreateTimetableDayOverrideInput) => mutate({ variables: { input } }),
    loading,
  };
}

export function useClearTimetableDayOverride() {
  const [mutate, { loading }] = useMutation(CLEAR_TIMETABLE_DAY_OVERRIDE, {
    refetchQueries: ['TimetableDaySchedule', 'StaffDaySchedule', 'TimetableDayOverrides'],
  });
  return {
    clearOverride: (id: string) => mutate({ variables: { id } }),
    loading,
  };
}
