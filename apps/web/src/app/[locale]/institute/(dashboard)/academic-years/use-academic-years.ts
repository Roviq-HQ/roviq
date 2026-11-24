'use client';

import { gql, useMutation, useQuery } from '@roviq/graphql';
import type {
  AcademicYearModel,
  AcademicYearRolloverPreview,
  RolloverSectionLoad,
  RolloverSectionMove,
} from '@roviq/graphql/generated';

const ACADEMIC_YEARS_QUERY = gql`
  query AcademicYears {
    academicYears {
      id
      label
      startDate
      endDate
      isActive
      status
      termStructure { label startDate endDate }
      boardExamDates
      createdAt
      updatedAt
    }
  }
`;

const ACTIVE_ACADEMIC_YEAR_QUERY = gql`
  query ActiveAcademicYear {
    activeAcademicYear {
      id
      label
      status
    }
  }
`;

const CREATE_ACADEMIC_YEAR = gql`
  mutation CreateAcademicYear($input: CreateAcademicYearInput!) {
    createAcademicYear(input: $input) {
      id
      label
      startDate
      endDate
      isActive
      status
      termStructure { label startDate endDate }
    }
  }
`;

const ACTIVATE_ACADEMIC_YEAR = gql`
  mutation ActivateAcademicYear($id: ID!) {
    activateAcademicYear(id: $id) {
      id
      label
      isActive
      status
    }
  }
`;

const ACADEMIC_YEAR_ROLLOVER_PREVIEW = gql`
  query AcademicYearRolloverPreview($academicYearId: ID!) {
    academicYearRolloverPreview(academicYearId: $academicYearId) {
      movingUp
      staying
      completing
      notCarried
      noClassInNewYear
      alreadyPlaced
      sections {
        sectionId
        standardId
        standardName
        sectionName
        currentStrength
        incoming
        capacity
      }
      moves {
        fromSectionId
        fromStandardName
        fromSectionName
        toStandardId
        toSectionId
        students
        overridden
      }
    }
  }
`;

const SET_ROLLOVER_SECTION_MAP = gql`
  mutation SetRolloverSectionMap($input: SetRolloverSectionMapInput!) {
    setRolloverSectionMap(input: $input) {
      movingUp
    }
  }
`;

const ARCHIVE_ACADEMIC_YEAR = gql`
  mutation ArchiveAcademicYear($id: ID!) {
    archiveAcademicYear(id: $id) {
      id
      label
      isActive
      status
    }
  }
`;

const DELETE_ACADEMIC_YEAR = gql`
  mutation DeleteAcademicYear($id: ID!) {
    deleteAcademicYear(id: $id)
  }
`;

export type AcademicYear = AcademicYearModel;

export function useAcademicYears() {
  const { data, loading, error, refetch } = useQuery<{ academicYears: AcademicYear[] }>(
    ACADEMIC_YEARS_QUERY,
  );

  return {
    years: data?.academicYears ?? [],
    loading,
    error,
    refetch,
  };
}

export function useActiveAcademicYear() {
  const { data, loading } = useQuery<{
    activeAcademicYear: { id: string; label: string; status: string } | null;
  }>(ACTIVE_ACADEMIC_YEAR_QUERY);

  return {
    activeYear: data?.activeAcademicYear ?? null,
    loading,
  };
}

export function useCreateAcademicYear() {
  const [mutate, { loading }] = useMutation(CREATE_ACADEMIC_YEAR, {
    refetchQueries: ['AcademicYears', 'ActiveAcademicYear'],
  });

  return {
    createYear: (input: {
      label: string;
      startDate: string;
      endDate: string;
      termStructure?: Array<{ label: string; startDate: string; endDate: string }>;
    }) => mutate({ variables: { input } }),
    loading,
  };
}

export function useActivateAcademicYear() {
  const [mutate, { loading }] = useMutation(ACTIVATE_ACADEMIC_YEAR, {
    refetchQueries: ['AcademicYears', 'ActiveAcademicYear'],
  });

  return {
    activateYear: (id: string) => mutate({ variables: { id } }),
    loading,
  };
}

export type RolloverSection = Omit<RolloverSectionLoad, '__typename'>;
export type RolloverMove = Omit<RolloverSectionMove, '__typename'>;
export type RolloverPreview = Omit<
  AcademicYearRolloverPreview,
  '__typename' | 'sections' | 'moves'
> & { sections: RolloverSection[]; moves: RolloverMove[] };

/** Loads only while `academicYearId` is set, and never from cache: student records change. */
export function useAcademicYearRolloverPreview(academicYearId: string | null) {
  const { data, loading, error } = useQuery<{ academicYearRolloverPreview: RolloverPreview }>(
    ACADEMIC_YEAR_ROLLOVER_PREVIEW,
    {
      variables: { academicYearId: academicYearId ?? '' },
      skip: !academicYearId,
      fetchPolicy: 'network-only',
    },
  );

  return { preview: data?.academicYearRolloverPreview ?? null, loading, error };
}

/** Chooses the section the students of one section go to; `toSectionId: null` restores the name rule. */
export function useSetRolloverSectionMap() {
  const [mutate, { loading }] = useMutation(SET_ROLLOVER_SECTION_MAP, {
    refetchQueries: ['AcademicYearRolloverPreview'],
    awaitRefetchQueries: true,
  });

  return {
    setSectionTarget: (
      academicYearId: string,
      entry: { fromSectionId: string; toSectionId: string | null },
    ) => mutate({ variables: { input: { academicYearId, entries: [entry] } } }),
    loading,
  };
}

export function useArchiveAcademicYear() {
  const [mutate, { loading }] = useMutation(ARCHIVE_ACADEMIC_YEAR, {
    refetchQueries: ['AcademicYears', 'ActiveAcademicYear'],
  });

  return {
    archiveYear: (id: string) => mutate({ variables: { id } }),
    loading,
  };
}

export function useDeleteAcademicYear() {
  const [mutate, { loading }] = useMutation(DELETE_ACADEMIC_YEAR, {
    refetchQueries: ['AcademicYears', 'ActiveAcademicYear'],
  });

  return {
    deleteYear: (id: string) => mutate({ variables: { id } }),
    loading,
  };
}
