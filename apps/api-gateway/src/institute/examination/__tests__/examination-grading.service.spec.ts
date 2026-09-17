import { describe, expect, it } from 'vitest';
import { ExaminationGradingService, type GradeBandInput } from '../examination-grading.service';

// CBSE-style scholastic bands.
const BANDS: GradeBandInput[] = [
  {
    grade: 'A1',
    minPercent: 91,
    maxPercent: 100,
    gradePoint: 10,
    isPassing: true,
    descriptor: 'Outstanding',
  },
  {
    grade: 'A2',
    minPercent: 81,
    maxPercent: 90.99,
    gradePoint: 9,
    isPassing: true,
    descriptor: 'Excellent',
  },
  {
    grade: 'B1',
    minPercent: 71,
    maxPercent: 80.99,
    gradePoint: 8,
    isPassing: true,
    descriptor: 'Very Good',
  },
  {
    grade: 'C1',
    minPercent: 33,
    maxPercent: 70.99,
    gradePoint: 6,
    isPassing: true,
    descriptor: 'Fair',
  },
  {
    grade: 'E',
    minPercent: 0,
    maxPercent: 32.99,
    gradePoint: 0,
    isPassing: false,
    descriptor: 'Needs Improvement',
  },
];

describe('ExaminationGradingService', () => {
  const svc = new ExaminationGradingService();

  it('computes percentage with 2dp rounding', () => {
    expect(svc.percentage(45, 50)).toBe(90);
    expect(svc.percentage(1, 3)).toBe(33.33);
    expect(svc.percentage(0, 0)).toBe(0);
  });

  it('resolves the grade band for a percentage (inclusive bounds)', () => {
    expect(svc.gradeForPercent(BANDS, 95)?.grade).toBe('A1');
    expect(svc.gradeForPercent(BANDS, 91)?.grade).toBe('A1');
    expect(svc.gradeForPercent(BANDS, 32)?.grade).toBe('E');
    expect(svc.gradeForPercent(BANDS, 70.5)?.grade).toBe('C1');
  });

  it('aggregates subject components, excluding exempted and summing maxima', () => {
    const result = svc.subjectResult(
      [
        { maxMarks: 70, obtainedMarks: 63, isAbsent: false, isExempted: false }, // theory
        { maxMarks: 30, obtainedMarks: 27, isAbsent: false, isExempted: false }, // practical
        { maxMarks: 20, obtainedMarks: 0, isAbsent: false, isExempted: true }, // exempted internal
      ],
      BANDS,
    );
    expect(result.maxMarks).toBe(100);
    expect(result.obtainedMarks).toBe(90);
    expect(result.percentage).toBe(90);
    expect(result.grade).toBe('A2');
    expect(result.gradePoint).toBe(9);
    expect(result.isPassing).toBe(true);
    expect(result.isAbsent).toBe(false);
  });

  it('marks a subject absent when all counted components are absent', () => {
    const result = svc.subjectResult(
      [{ maxMarks: 100, obtainedMarks: null, isAbsent: true, isExempted: false }],
      BANDS,
    );
    expect(result.isAbsent).toBe(true);
    expect(result.grade).toBeNull();
    expect(result.isPassing).toBe(false);
  });

  it('computes a weighted term percentage, excluding absent exams from the weight base', () => {
    const agg = svc.weightedTermPercentage([
      { percentage: 80, weight: 10, isAbsent: false }, // unit test
      { percentage: 90, weight: 90, isAbsent: false }, // term exam
    ]);
    // (80*10 + 90*90) / 100 = 89
    expect(agg.percentage).toBe(89);
    expect(agg.isAbsent).toBe(false);

    const withAbsent = svc.weightedTermPercentage([
      { percentage: 0, weight: 10, isAbsent: true },
      { percentage: 90, weight: 90, isAbsent: false },
    ]);
    expect(withAbsent.percentage).toBe(90); // absent unit test excluded
  });

  it('computes GPA as the mean of grade points', () => {
    expect(svc.gpa([10, 9, 8])).toBe(9);
    expect(svc.gpa([10, null, 8])).toBe(9);
    expect(svc.gpa([null])).toBeNull();
  });

  it('dense-ranks students by value with shared ranks for ties', () => {
    const ranks = svc.denseRank([
      { id: 's1', value: 95 },
      { id: 's2', value: 90 },
      { id: 's3', value: 90 },
      { id: 's4', value: 85 },
    ]);
    expect(ranks.get('s1')).toBe(1);
    expect(ranks.get('s2')).toBe(2);
    expect(ranks.get('s3')).toBe(2);
    expect(ranks.get('s4')).toBe(3); // dense — not 4
  });

  it('derives the overall result from per-subject pass flags', () => {
    expect(svc.overallResult([{ isPassing: true, isAbsent: false }])).toBe('PASS');
    expect(
      svc.overallResult([
        { isPassing: true, isAbsent: false },
        { isPassing: false, isAbsent: false },
      ]),
    ).toBe('COMPARTMENT');
    expect(
      svc.overallResult([
        { isPassing: false, isAbsent: false },
        { isPassing: false, isAbsent: false },
        { isPassing: false, isAbsent: false },
      ]),
    ).toBe('FAIL');
    expect(svc.overallResult([{ isPassing: false, isAbsent: true }])).toBe('ABSENT');
  });

  it('validates scholastic bands cover 0–100 without gaps or overlaps', () => {
    expect(() => svc.assertValidScholasticBands(BANDS)).not.toThrow();
    expect(() =>
      svc.assertValidScholasticBands([
        {
          grade: 'A',
          minPercent: 50,
          maxPercent: 100,
          gradePoint: 10,
          isPassing: true,
          descriptor: null,
        },
      ]),
    ).toThrow(); // does not start at 0
    expect(() =>
      svc.assertValidScholasticBands([
        {
          grade: 'A',
          minPercent: 50,
          maxPercent: 100,
          gradePoint: 10,
          isPassing: true,
          descriptor: null,
        },
        {
          grade: 'B',
          minPercent: 0,
          maxPercent: 60,
          gradePoint: 5,
          isPassing: true,
          descriptor: null,
        },
      ]),
    ).toThrow(); // overlap
    // Co-scholastic (no percents) is skipped.
    expect(() =>
      svc.assertValidScholasticBands([
        {
          grade: 'A',
          minPercent: null,
          maxPercent: null,
          gradePoint: null,
          isPassing: true,
          descriptor: null,
        },
      ]),
    ).not.toThrow();
  });
});
