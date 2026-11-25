import type {
  ChangeClassData,
  ChangeClassResult,
  ClassChangeRules,
  EnrolTargetData,
  EnrolTargetResult,
  PlacementResult,
  PromotionDecisionData,
  RemoveFromYearResult,
  SectionCapacityRecord,
  SectionStrengthChange,
  StudentAcademicHistoryRecord,
  StudentAcademicPlacementRecord,
} from './types';

export abstract class StudentAcademicRepository {
  /** Newest year first. */
  abstract listHistory(
    tenantId: string,
    studentProfileId: string,
  ): Promise<StudentAcademicHistoryRecord[]>;
  /**
   * Foreign keys do not apply RLS: the student, year, class and section are read here, in that
   * order, so another institute's id is refused as not found.
   */
  abstract checkEnrolTarget(tenantId: string, data: EnrolTargetData): Promise<EnrolTargetResult>;
  abstract findSectionCapacity(
    tenantId: string,
    sectionId: string,
  ): Promise<SectionCapacityRecord | null>;
  /**
   * Null when the year record is already placed (live row for the same student and year). The
   * section is locked for the insert, so the strength change is this placement's own.
   */
  abstract createPlacement(
    tenantId: string,
    data: EnrolTargetData & { actorId: string },
  ): Promise<PlacementResult | null>;
  abstract findPlacement(
    tenantId: string,
    studentAcademicId: string,
  ): Promise<StudentAcademicPlacementRecord | null>;
  /** The new section's strength change under its lock; null when that section is gone. */
  abstract setSection(
    tenantId: string,
    studentAcademicId: string,
    sectionId: string,
    actorId: string,
  ): Promise<SectionStrengthChange | null>;
  /** Moves the year record and rewrites last year's result in one transaction. */
  abstract changeClass(
    tenantId: string,
    data: ChangeClassData,
    rules: ClassChangeRules,
  ): Promise<ChangeClassResult>;
  /** Soft-deletes the year record unless the year holds any of the student's records. */
  abstract removeFromYear(
    tenantId: string,
    studentAcademicId: string,
    actorId: string,
  ): Promise<RemoveFromYearResult>;
  /**
   * Sets the result on every id in one transaction. `assertAllUpdated` runs before commit with the
   * number of rows changed, so a throw there writes nothing.
   */
  abstract setPromotionDecisions(
    tenantId: string,
    data: PromotionDecisionData,
    assertAllUpdated: (updated: number) => void,
  ): Promise<number>;
}
