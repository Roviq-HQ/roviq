'use client';

import { subject } from '@casl/ability';
import { useAbility } from '@roviq/ui';
import * as React from 'react';
import type { LeaveStatus } from './use-leave';

/** Whom the signed-in person may file a leave for. */
export type ApplicantMode = 'anyone' | 'children' | 'self';

/**
 * What the leave rules know about a student applicant beyond the leave row itself:
 * guardian rules match `studentProfileId`, class-teacher rules match `sectionId`/`standardId`.
 */
export interface ApplicantFacts {
  studentProfileId: string;
  sectionId: string | null;
  standardId: string | null;
}

const APPLICANT_KEYS = ['studentProfileId', 'sectionId', 'standardId'];

/**
 * Read from the `create Leave` rules (placeholders already substituted by the server):
 * an unconditional rule means anyone, a `studentProfileId` rule means linked children
 * (guardians), anything else means only themself.
 */
export function useApplicantMode(): ApplicantMode {
  const ability = useAbility();
  return React.useMemo(() => {
    const rules = ability.rulesFor('create', 'Leave').filter((rule) => !rule.inverted);
    if (rules.some((rule) => !rule.conditions)) return 'anyone';
    if (rules.some((rule) => rule.conditions != null && 'studentProfileId' in rule.conditions)) {
      return 'children';
    }
    return 'self';
  }, [ability]);
}

/** True when a decide or withdraw rule can only be checked with the applicant's student facts. */
export function useLeaveRulesNeedApplicant(): boolean {
  const ability = useAbility();
  return React.useMemo(
    () =>
      [...ability.rulesFor('update', 'Leave'), ...ability.rulesFor('withdraw', 'Leave')].some(
        (rule) => {
          const conditions = rule.conditions;
          return conditions != null && APPLICANT_KEYS.some((key) => key in conditions);
        },
      ),
    [ability],
  );
}

/**
 * True when some read rule reaches beyond the caller's own leaves and their children's,
 * which is when filtering by applicant means anything.
 */
export function useReadsOthersLeaves(): boolean {
  const ability = useAbility();
  return React.useMemo(
    () =>
      ability
        .rulesFor('read', 'Leave')
        .some(
          (rule) =>
            !rule.inverted &&
            (!rule.conditions ||
              Object.keys(rule.conditions).some(
                (key) => key !== 'userId' && key !== 'studentProfileId',
              )),
        ),
    [ability],
  );
}

/** Fresh per call: CASL's `subject()` tags the object it is given. */
export function leaveSubject(
  leave: { userId: string; status: LeaveStatus },
  facts: ApplicantFacts | null,
) {
  return subject('Leave', {
    userId: leave.userId,
    status: leave.status,
    ...(facts
      ? {
          studentProfileId: facts.studentProfileId,
          ...(facts.sectionId ? { sectionId: facts.sectionId } : {}),
          ...(facts.standardId ? { standardId: facts.standardId } : {}),
        }
      : {}),
  });
}

/** Keyed by membership id, the id a leave stores. */
export function applicantFactsByMembership(
  students: ReadonlyArray<{
    id: string;
    membershipId?: string | null;
    currentSectionId?: string | null;
    currentStandardId?: string | null;
  }>,
): Map<string, ApplicantFacts> {
  const map = new Map<string, ApplicantFacts>();
  for (const student of students) {
    if (!student.membershipId) continue;
    map.set(student.membershipId, {
      studentProfileId: student.id,
      sectionId: student.currentSectionId ?? null,
      standardId: student.currentStandardId ?? null,
    });
  }
  return map;
}

/** Filters a student list down to the applicants the caller may file for. */
export function useMayApplyFor(): (student: { id: string; membershipId: string }) => boolean {
  const ability = useAbility();
  return React.useCallback(
    (student) =>
      ability.can(
        'create',
        subject('Leave', { userId: student.membershipId, studentProfileId: student.id }),
      ),
    [ability],
  );
}
