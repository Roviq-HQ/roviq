import { Field, Float, ID, Int, ObjectType, registerEnumType } from '@nestjs/graphql';
import {
  AssessmentComponent,
  CompetencyLevel,
  ExamStatus,
  ExamType,
  GradingSchemeKind,
  ReportCardStatus,
  ResultStatus,
} from '@roviq/common-types';
import type { I18nContent } from '@roviq/database';
import { I18nTextScalar } from '@roviq/nestjs-graphql';

registerEnumType(ExamType, { name: 'ExamType', description: 'Kind of assessment event.' });
registerEnumType(ExamStatus, {
  name: 'ExamStatus',
  description: 'DRAFT → SCHEDULED → MARKS_ENTRY → LOCKED → RESULTS_PUBLISHED → ARCHIVED.',
});
registerEnumType(AssessmentComponent, {
  name: 'AssessmentComponent',
  description: 'Marks component: THEORY / PRACTICAL / INTERNAL / PROJECT / ORAL.',
});
registerEnumType(GradingSchemeKind, {
  name: 'GradingSchemeKind',
  description: 'SCHOLASTIC (marks→grade) or CO_SCHOLASTIC (qualitative).',
});
registerEnumType(CompetencyLevel, {
  name: 'CompetencyLevel',
  description: 'NEP topic attainment: BEGINNER / PROGRESSING / PROFICIENT / ADVANCED.',
});
registerEnumType(ReportCardStatus, {
  name: 'ReportCardStatus',
  description: 'DRAFT → GENERATED → PUBLISHED → ARCHIVED.',
});
registerEnumType(ResultStatus, {
  name: 'ResultStatus',
  description: 'PASS / FAIL / COMPARTMENT / ABSENT / PENDING.',
});

@ObjectType({ description: 'One band of a grade scheme (mark range → grade + grade point).' })
export class GradeBandModel {
  @Field(() => ID) id!: string;
  @Field(() => String) grade!: string;
  @Field(() => Float, { nullable: true }) minPercent!: number | null;
  @Field(() => Float, { nullable: true }) maxPercent!: number | null;
  @Field(() => Float, { nullable: true }) gradePoint!: number | null;
  @Field(() => String, { nullable: true }) descriptor!: string | null;
  @Field(() => Boolean) isPassing!: boolean;
  @Field(() => Int) sequence!: number;
}

@ObjectType({ description: 'A configurable grade scheme.' })
export class GradingSchemeModel {
  @Field(() => ID) id!: string;
  @Field(() => I18nTextScalar) name!: I18nContent;
  @Field(() => GradingSchemeKind) kind!: GradingSchemeKind;
  @Field(() => String, { nullable: true }) board!: string | null;
  @Field(() => Boolean) isDefault!: boolean;
  @Field(() => [GradeBandModel], { nullable: true }) bands?: GradeBandModel[];
}

@ObjectType({ description: 'A term within an academic year that report cards aggregate over.' })
export class ExamTermModel {
  @Field(() => ID) id!: string;
  @Field(() => ID) academicYearId!: string;
  @Field(() => I18nTextScalar) name!: I18nContent;
  @Field(() => Int) sequence!: number;
  @Field(() => Float, { description: 'Weight in an annual roll-up (percent).' })
  weightInFinal!: number;
}

@ObjectType({ description: 'An assessment event.' })
export class ExamModel {
  @Field(() => ID) id!: string;
  @Field(() => ID) academicYearId!: string;
  @Field(() => ID, { nullable: true }) examTermId!: string | null;
  @Field(() => I18nTextScalar) name!: I18nContent;
  @Field(() => ExamType) type!: ExamType;
  @Field(() => ID, { nullable: true }) gradingSchemeId!: string | null;
  @Field(() => ExamStatus) status!: ExamStatus;
  @Field(() => String, { nullable: true }) startDate!: string | null;
  @Field(() => String, { nullable: true }) endDate!: string | null;
  @Field(() => Float, { description: "This exam's weight within its term (percent)." })
  weightInTerm!: number;
  @Field(() => String, { nullable: true }) description!: string | null;
}

@ObjectType({ description: 'Paginated exams.' })
export class PaginatedExamsModel {
  @Field(() => [ExamModel]) docs!: ExamModel[];
  @Field(() => Int) total!: number;
  @Field(() => Int) page!: number;
  @Field(() => Int) perPage!: number;
  @Field(() => Int) totalPages!: number;
}

@ObjectType({ description: 'One datesheet row: what is examined, when, and for how many marks.' })
export class ExamScheduleModel {
  @Field(() => ID) id!: string;
  @Field(() => ID) examId!: string;
  @Field(() => ID) sectionId!: string;
  @Field(() => ID) subjectId!: string;
  @Field(() => AssessmentComponent) component!: AssessmentComponent;
  @Field(() => String, { nullable: true }) examDate!: string | null;
  @Field(() => String, { nullable: true }) startTime!: string | null;
  @Field(() => String, { nullable: true }) endTime!: string | null;
  @Field(() => Float) maxMarks!: number;
  @Field(() => Float, { nullable: true }) passMarks!: number | null;
  @Field(() => String, { nullable: true }) room!: string | null;
  @Field(() => ID, { nullable: true }) invigilatorId!: string | null;
}

@ObjectType({ description: "A student's editable row in a marks sheet." })
export class MarksSheetRowModel {
  @Field(() => ID) studentId!: string;
  @Field(() => ID) studentProfileId!: string;
  @Field(() => String, { nullable: true }) rollNumber!: string | null;
  @Field(() => String) name!: string;
  @Field(() => Float, { nullable: true }) obtainedMarks!: number | null;
  @Field(() => Boolean) isAbsent!: boolean;
  @Field(() => Boolean) isExempted!: boolean;
  @Field(() => String, { nullable: true }) remarks!: string | null;
}

@ObjectType({ description: 'The marks-entry grid for one datesheet row.' })
export class MarksSheetModel {
  @Field(() => ExamScheduleModel) schedule!: ExamScheduleModel;
  @Field(() => [MarksSheetRowModel]) rows!: MarksSheetRowModel[];
}

@ObjectType({ description: "A subject's aggregated result for one student." })
export class SubjectResultModel {
  @Field(() => ID) subjectId!: string;
  @Field(() => String) subjectName!: string;
  @Field(() => Float) maxMarks!: number;
  @Field(() => Float) obtainedMarks!: number;
  @Field(() => Float) percentage!: number;
  @Field(() => String, { nullable: true }) grade!: string | null;
  @Field(() => Float, { nullable: true }) gradePoint!: number | null;
  @Field(() => Boolean) isAbsent!: boolean;
  @Field(() => Boolean) isPassing!: boolean;
}

@ObjectType({ description: "A student's full result for an exam (with rank)." })
export class StudentExamResultModel {
  @Field(() => ID) studentId!: string;
  @Field(() => ID) studentProfileId!: string;
  @Field(() => String, { nullable: true }) rollNumber!: string | null;
  @Field(() => String) name!: string;
  @Field(() => [SubjectResultModel]) subjects!: SubjectResultModel[];
  @Field(() => Float) maxMarks!: number;
  @Field(() => Float) obtainedMarks!: number;
  @Field(() => Float) percentage!: number;
  @Field(() => Float, { nullable: true }) gpa!: number | null;
  @Field(() => ResultStatus) resultStatus!: ResultStatus;
  @Field(() => Int, { nullable: true }) rank!: number | null;
}

// ── NEP topics + co-scholastic config ─────────────────────────────────────────

@ObjectType({ description: 'A NEP learning outcome / topic for a subject.' })
export class SubjectTopicModel {
  @Field(() => ID) id!: string;
  @Field(() => ID) subjectId!: string;
  @Field(() => ID, { nullable: true }) standardId!: string | null;
  @Field(() => I18nTextScalar) name!: I18nContent;
  @Field(() => String, { nullable: true }) code!: string | null;
  @Field(() => String, { nullable: true }) learningOutcome!: string | null;
  @Field(() => Int) sequence!: number;
}

@ObjectType({ description: 'A configurable co-scholastic domain.' })
export class CoScholasticAreaModel {
  @Field(() => ID) id!: string;
  @Field(() => I18nTextScalar) name!: I18nContent;
  @Field(() => ID, { nullable: true }) gradingSchemeId!: string | null;
  @Field(() => Int) sequence!: number;
}

// ── Report cards ──────────────────────────────────────────────────────────────

@ObjectType({ description: 'A report-card template/config.' })
export class ReportCardModel {
  @Field(() => ID) id!: string;
  @Field(() => ID) academicYearId!: string;
  @Field(() => ID, { nullable: true }) examTermId!: string | null;
  @Field(() => I18nTextScalar) name!: I18nContent;
  @Field(() => ID, { nullable: true }) gradingSchemeId!: string | null;
  @Field(() => Boolean) includeAttendance!: boolean;
  @Field(() => Boolean) includeCoScholastic!: boolean;
  @Field(() => Boolean) includeTopicWise!: boolean;
  @Field(() => ReportCardStatus) status!: ReportCardStatus;
}

@ObjectType()
export class ReportCardExamBreakdownModel {
  @Field(() => String) examName!: string;
  @Field(() => Float) percentage!: number;
  @Field(() => Float) weight!: number;
}

@ObjectType()
export class ReportCardTopicModel {
  @Field(() => String) name!: string;
  @Field(() => String) competency!: string;
  @Field(() => String, { nullable: true }) descriptor!: string | null;
}

@ObjectType()
export class ReportCardSubjectModel {
  @Field(() => ID) subjectId!: string;
  @Field(() => String) subjectName!: string;
  @Field(() => Float) percentage!: number;
  @Field(() => String, { nullable: true }) grade!: string | null;
  @Field(() => Float, { nullable: true }) gradePoint!: number | null;
  @Field(() => Boolean) isAbsent!: boolean;
  @Field(() => [ReportCardExamBreakdownModel]) exams!: ReportCardExamBreakdownModel[];
  @Field(() => [ReportCardTopicModel]) topics!: ReportCardTopicModel[];
}

@ObjectType()
export class ReportCardStudentModel {
  @Field(() => String) name!: string;
  @Field(() => String, { nullable: true }) rollNumber!: string | null;
}

@ObjectType()
export class ReportCardCoScholasticModel {
  @Field(() => String) area!: string;
  @Field(() => String) grade!: string;
  @Field(() => String, { nullable: true }) descriptor!: string | null;
}

@ObjectType({ description: 'The computed report-card snapshot.' })
export class ReportCardPayloadModel {
  @Field(() => String, { nullable: true }) termName!: string | null;
  @Field(() => ReportCardStudentModel) student!: ReportCardStudentModel;
  @Field(() => [ReportCardSubjectModel]) subjects!: ReportCardSubjectModel[];
  @Field(() => [ReportCardCoScholasticModel]) coScholastic!: ReportCardCoScholasticModel[];
}

@ObjectType({ description: 'A materialised per-student report card.' })
export class ReportCardInstanceModel {
  @Field(() => ID) id!: string;
  @Field(() => ID) reportCardId!: string;
  @Field(() => ID) studentProfileId!: string;
  @Field(() => ID, { nullable: true }) sectionId!: string | null;
  @Field(() => ReportCardStatus) status!: ReportCardStatus;
  @Field(() => Float, { nullable: true }) percentage!: number | null;
  @Field(() => Float, { nullable: true }) gpa!: number | null;
  @Field(() => String, { nullable: true }) grade!: string | null;
  @Field(() => Int, { nullable: true }) rank!: number | null;
  @Field(() => Float, { nullable: true }) attendancePercent!: number | null;
  @Field(() => ResultStatus) resultStatus!: ResultStatus;
  @Field(() => String, { nullable: true }) classTeacherRemark!: string | null;
  @Field(() => String, { nullable: true }) principalRemark!: string | null;
  @Field(() => ReportCardPayloadModel) payload!: ReportCardPayloadModel;
}
