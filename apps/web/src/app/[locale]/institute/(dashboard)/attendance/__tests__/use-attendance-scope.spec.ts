import { describe, expect, it } from 'vitest';
import type { AttendanceSectionOption } from '../use-attendance';
import { resolveAttendanceScope } from '../use-attendance-scope';

function section(id: string, standardId: string): AttendanceSectionOption {
  return {
    id,
    name: { en: id },
    displayLabel: `Class ${id}`,
    standardId,
    standardName: { en: standardId },
    classTeacherId: null,
  };
}

const A = section('a', 'std-5');
const B = section('b', 'std-5');
const C = section('c', 'std-6');
const NONE = { standardId: null, sectionId: null };

describe('resolveAttendanceScope', () => {
  it('should preselect the only permitted standard and section', () => {
    expect(resolveAttendanceScope([A], NONE)).toEqual({
      standards: [{ id: 'std-5', name: { en: 'std-5' } }],
      sectionsForStandard: [A],
      standardId: 'std-5',
      sectionId: 'a',
      allowAllStandards: false,
      allowAllSections: false,
    });
  });

  it('should replace a tampered section with the only permitted one', () => {
    const result = resolveAttendanceScope([A], { standardId: 'std-5', sectionId: 'b' });

    expect(result.sectionId).toBe('a');
  });

  it('should drop an unknown standard and section when several are permitted', () => {
    const result = resolveAttendanceScope([A, B, C], { standardId: 'std-9', sectionId: 'zz' });

    expect(result.standardId).toBeNull();
    expect(result.sectionId).toBeNull();
    expect(result.allowAllStandards).toBe(true);
  });

  it('should keep a valid explicit selection among several permitted sections', () => {
    const result = resolveAttendanceScope([A, B, C], { standardId: 'std-5', sectionId: 'b' });

    expect(result.standardId).toBe('std-5');
    expect(result.sectionId).toBe('b');
    expect(result.sectionsForStandard).toEqual([A, B]);
    expect(result.allowAllSections).toBe(true);
  });

  it('should infer the standard from a valid section when the standard is missing', () => {
    const result = resolveAttendanceScope([A, B, C], { standardId: null, sectionId: 'c' });

    expect(result.standardId).toBe('std-6');
    expect(result.sectionId).toBe('c');
  });

  it('should drop a section that belongs to a different selected standard', () => {
    const result = resolveAttendanceScope([A, B, C], { standardId: 'std-6', sectionId: 'a' });

    expect(result.standardId).toBe('std-6');
    expect(result.sectionId).toBeNull();
  });

  it('should select nothing without assignments', () => {
    const result = resolveAttendanceScope([], { standardId: 'std-5', sectionId: 'a' });

    expect(result.standards).toEqual([]);
    expect(result.standardId).toBeNull();
    expect(result.sectionId).toBeNull();
  });

  it('should never select a section in standard-only mode', () => {
    const result = resolveAttendanceScope([A], { standardId: null, sectionId: 'a' }, false);

    expect(result.standardId).toBe('std-5');
    expect(result.sectionId).toBeNull();
  });
});
