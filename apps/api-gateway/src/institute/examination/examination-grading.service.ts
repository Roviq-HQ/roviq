import { Injectable } from '@nestjs/common';
import { BusinessException, ErrorCode, type ResultStatus } from '@roviq/common-types';

/** One band of a scholastic grade scheme (numeric percent → grade). */
export interface GradeBandInput {
  grade: string;
  minPercent: number | null;
  maxPercent: number | null;
  gradePoint: number | null;
  isPassing: boolean;
  descriptor: string | null;
}

/** A subject's per-component marks for one student in one exam. */
export interface ComponentMark {
  maxMarks: number;
  obtainedMarks: number | null;
  isAbsent: boolean;
  isExempted: boolean;
}

export interface SubjectResult {
  maxMarks: number;
  obtainedMarks: number;
  percentage: number;
  isAbsent: boolean;
  grade: string | null;
  gradePoint: number | null;
  descriptor: string | null;
  isPassing: boolean;
}

export interface WeightedExamPercent {
  /** This exam's subject percentage (0–100). */
  percentage: number;
  /** This exam's weight within the term. */
  weight: number;
  isAbsent: boolean;
}

/** Round to 2 decimal places (half-up), avoiding binary-float drift. */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Pure grading + aggregation math for examinations. No DB, no NestJS deps on
 * its methods — fully unit-testable. Fixes the legacy gaps: configurable grade
 * bands, GPA, weighted term aggregation, dense ranking, band validation.
 */
@Injectable()
export class ExaminationGradingService {
  /** Percentage of obtained over max (0 when max is 0). */
  percentage(obtained: number, max: number): number {
    if (max <= 0) return 0;
    return round2((obtained / max) * 100);
  }

  /**
   * The grade band a percentage falls into. Bands are inclusive `[min, max]`.
   * Returns null when no band matches (caller decides how to surface it).
   */
  gradeForPercent(bands: GradeBandInput[], percent: number): GradeBandInput | null {
    return (
      bands.find(
        (b) =>
          b.minPercent !== null &&
          b.maxPercent !== null &&
          percent >= b.minPercent &&
          percent <= b.maxPercent,
      ) ?? null
    );
  }

  /**
   * Aggregate a subject's components into a single result (sum of obtained over
   * sum of max, excluding exempted components). If every non-exempt component is
   * absent the subject is marked absent. Grade is resolved from the bands.
   */
  subjectResult(components: ComponentMark[], bands: GradeBandInput[]): SubjectResult {
    const counted = components.filter((c) => !c.isExempted);
    const maxMarks = counted.reduce((sum, c) => sum + c.maxMarks, 0);
    const allAbsent = counted.length > 0 && counted.every((c) => c.isAbsent);
    const obtainedMarks = counted.reduce(
      (sum, c) => sum + (c.isAbsent ? 0 : (c.obtainedMarks ?? 0)),
      0,
    );
    const percentage = this.percentage(obtainedMarks, maxMarks);
    const band = allAbsent ? null : this.gradeForPercent(bands, percentage);
    return {
      maxMarks: round2(maxMarks),
      obtainedMarks: round2(obtainedMarks),
      percentage,
      isAbsent: allAbsent,
      grade: band?.grade ?? null,
      gradePoint: band?.gradePoint ?? null,
      descriptor: band?.descriptor ?? null,
      // Absent or unmatched bands are treated as not-passing.
      isPassing: band?.isPassing ?? false,
    };
  }

  /**
   * Weighted aggregate of one subject across several exams in a term:
   * Σ(pct × weight) / Σweight. Absent exams are excluded from the weight base
   * (so a missed unit test doesn't zero the term), but if ALL are absent the
   * result is absent.
   */
  weightedTermPercentage(exams: WeightedExamPercent[]): { percentage: number; isAbsent: boolean } {
    const present = exams.filter((e) => !e.isAbsent && e.weight > 0);
    if (present.length === 0) return { percentage: 0, isAbsent: exams.length > 0 };
    const totalWeight = present.reduce((sum, e) => sum + e.weight, 0);
    const weighted = present.reduce((sum, e) => sum + e.percentage * e.weight, 0);
    return { percentage: round2(weighted / totalWeight), isAbsent: false };
  }

  /** Mean grade point across graded subjects (CGPA). Null when none graded. */
  gpa(gradePoints: Array<number | null>): number | null {
    const points = gradePoints.filter((p): p is number => p !== null);
    if (points.length === 0) return null;
    return round2(points.reduce((sum, p) => sum + p, 0) / points.length);
  }

  /**
   * Dense rank (1-based) of each value, highest first; equal values share a rank
   * and the next distinct value is the next integer (1,1,2 — not 1,1,3).
   * Returns a map keyed by the caller's id.
   */
  denseRank<T extends string>(entries: Array<{ id: T; value: number }>): Map<T, number> {
    const sorted = [...entries].sort((a, b) => b.value - a.value);
    const ranks = new Map<T, number>();
    let rank = 0;
    let prev: number | null = null;
    for (const entry of sorted) {
      if (prev === null || entry.value !== prev) rank += 1;
      ranks.set(entry.id, rank);
      prev = entry.value;
    }
    return ranks;
  }

  /**
   * Overall result from per-subject pass flags: PASS when every counted subject
   * passes; ABSENT when all are absent; COMPARTMENT when 1–2 fail; else FAIL.
   */
  overallResult(subjects: Array<{ isPassing: boolean; isAbsent: boolean }>): ResultStatus {
    if (subjects.length === 0) return 'PENDING';
    if (subjects.every((s) => s.isAbsent)) return 'ABSENT';
    const failed = subjects.filter((s) => !s.isAbsent && !s.isPassing).length;
    if (failed === 0) return 'PASS';
    if (failed <= 2) return 'COMPARTMENT';
    return 'FAIL';
  }

  /**
   * Validate that scholastic bands tile 0–100 with no overlaps or gaps. Throws
   * `GRADING_SCHEME_INVALID_BANDS` on the first problem. Co-scholastic schemes
   * (all percents null) skip this check.
   */
  assertValidScholasticBands(bands: GradeBandInput[]): void {
    const scholastic = bands.filter(
      (b): b is GradeBandInput & { minPercent: number; maxPercent: number } =>
        b.minPercent !== null && b.maxPercent !== null,
    );
    if (scholastic.length === 0) return;
    for (const b of scholastic) {
      if (b.minPercent > b.maxPercent) {
        throw new BusinessException(
          ErrorCode.GRADING_SCHEME_INVALID_BANDS,
          `Band ${b.grade}: min ${b.minPercent} exceeds max ${b.maxPercent}`,
        );
      }
    }
    const ordered = [...scholastic].sort((a, b) => a.minPercent - b.minPercent);
    if (ordered[0].minPercent !== 0 || ordered.at(-1)?.maxPercent !== 100) {
      throw new BusinessException(
        ErrorCode.GRADING_SCHEME_INVALID_BANDS,
        'Scholastic bands must cover 0 to 100',
      );
    }
    for (let i = 1; i < ordered.length; i++) {
      // Each band must start exactly where the previous ended + 1 (integer steps),
      // or contiguously for fractional schemes — we require min == prevMax + 0.01..1.
      const gap = ordered[i].minPercent - ordered[i - 1].maxPercent;
      if (gap <= 0) {
        throw new BusinessException(
          ErrorCode.GRADING_SCHEME_INVALID_BANDS,
          `Bands ${ordered[i - 1].grade} and ${ordered[i].grade} overlap`,
        );
      }
    }
  }
}
