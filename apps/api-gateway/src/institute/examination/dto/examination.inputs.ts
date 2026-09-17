import { Field, Float, ID, InputType, Int } from '@nestjs/graphql';
import {
  ASSESSMENT_COMPONENT_VALUES,
  AssessmentComponent,
  COMPETENCY_LEVEL_VALUES,
  CompetencyLevel,
  EXAM_TYPE_VALUES,
  ExamType,
  GRADING_SCHEME_KIND_VALUES,
  GradingSchemeKind,
} from '@roviq/common-types';
import { I18nTextScalar } from '@roviq/nestjs-graphql';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

const TIME_REGEX = /^\d{2}:\d{2}(:\d{2})?$/;

// ── Grading schemes ──────────────────────────────────────────────────────────

@InputType({ description: 'One grade band. Scholastic bands set min/max/gradePoint.' })
export class GradeBandInputDto {
  @IsString()
  @IsNotEmpty()
  @Field(() => String, { description: 'Grade label, e.g. "A1".' })
  grade!: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  @Field(() => Float, { nullable: true })
  minPercent?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  @Field(() => Float, { nullable: true })
  maxPercent?: number | null;

  @IsOptional()
  @IsNumber()
  @Field(() => Float, { nullable: true })
  gradePoint?: number | null;

  @IsOptional()
  @IsString()
  @Field(() => String, { nullable: true })
  descriptor?: string | null;

  @IsOptional()
  @IsBoolean()
  @Field(() => Boolean, { nullable: true })
  isPassing?: boolean;

  @IsOptional()
  @IsInt()
  @Field(() => Int, { nullable: true })
  sequence?: number;
}

@InputType({ description: 'Create a grade scheme with its bands.' })
export class CreateGradingSchemeInput {
  @IsNotEmpty()
  @Field(() => I18nTextScalar, { description: 'Localised scheme name.' })
  name!: Record<string, string>;

  @IsIn(GRADING_SCHEME_KIND_VALUES)
  @Field(() => GradingSchemeKind)
  kind!: GradingSchemeKind;

  @IsOptional()
  @IsString()
  @Field(() => String, { nullable: true, description: 'Board label, e.g. "CBSE".' })
  board?: string | null;

  @IsOptional()
  @IsBoolean()
  @Field(() => Boolean, { nullable: true })
  isDefault?: boolean;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GradeBandInputDto)
  @Field(() => [GradeBandInputDto])
  bands!: GradeBandInputDto[];
}

@InputType({ description: 'Update a grade scheme (bands replaced separately).' })
export class UpdateGradingSchemeInput {
  @IsOptional()
  @IsNotEmpty()
  @Field(() => I18nTextScalar, { nullable: true })
  name?: Record<string, string>;

  @IsOptional()
  @IsString()
  @Field(() => String, { nullable: true })
  board?: string | null;

  @IsOptional()
  @IsBoolean()
  @Field(() => Boolean, { nullable: true })
  isDefault?: boolean;
}

// ── Exam terms ────────────────────────────────────────────────────────────────

@InputType({ description: 'Create a term within an academic year.' })
export class CreateExamTermInput {
  @IsUUID()
  @Field(() => ID)
  academicYearId!: string;

  @IsNotEmpty()
  @Field(() => I18nTextScalar)
  name!: Record<string, string>;

  @IsOptional()
  @IsInt()
  @Field(() => Int, { nullable: true })
  sequence?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  @Field(() => Float, { nullable: true, description: 'Weight in the annual roll-up (percent).' })
  weightInFinal?: number;
}

@InputType()
export class UpdateExamTermInput {
  @IsOptional()
  @IsNotEmpty()
  @Field(() => I18nTextScalar, { nullable: true })
  name?: Record<string, string>;

  @IsOptional()
  @IsInt()
  @Field(() => Int, { nullable: true })
  sequence?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  @Field(() => Float, { nullable: true })
  weightInFinal?: number;
}

// ── Exams ─────────────────────────────────────────────────────────────────────

@InputType({ description: 'Create an exam.' })
export class CreateExamInput {
  @IsUUID()
  @Field(() => ID)
  academicYearId!: string;

  @IsOptional()
  @IsUUID()
  @Field(() => ID, { nullable: true })
  examTermId?: string | null;

  @IsNotEmpty()
  @Field(() => I18nTextScalar)
  name!: Record<string, string>;

  @IsIn(EXAM_TYPE_VALUES)
  @Field(() => ExamType)
  type!: ExamType;

  @IsOptional()
  @IsUUID()
  @Field(() => ID, { nullable: true })
  gradingSchemeId?: string | null;

  @IsOptional()
  @IsDateString()
  @Field(() => String, { nullable: true, description: 'YYYY-MM-DD.' })
  startDate?: string | null;

  @IsOptional()
  @IsDateString()
  @Field(() => String, { nullable: true, description: 'YYYY-MM-DD.' })
  endDate?: string | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  @Field(() => Float, { nullable: true, description: 'Weight within the term (percent).' })
  weightInTerm?: number;

  @IsOptional()
  @IsString()
  @Field(() => String, { nullable: true })
  description?: string | null;
}

@InputType()
export class UpdateExamInput {
  @IsOptional()
  @IsNotEmpty()
  @Field(() => I18nTextScalar, { nullable: true })
  name?: Record<string, string>;

  @IsOptional()
  @IsIn(EXAM_TYPE_VALUES)
  @Field(() => ExamType, { nullable: true })
  type?: ExamType;

  @IsOptional()
  @IsUUID()
  @Field(() => ID, { nullable: true })
  examTermId?: string | null;

  @IsOptional()
  @IsUUID()
  @Field(() => ID, { nullable: true })
  gradingSchemeId?: string | null;

  @IsOptional()
  @IsDateString()
  @Field(() => String, { nullable: true })
  startDate?: string | null;

  @IsOptional()
  @IsDateString()
  @Field(() => String, { nullable: true })
  endDate?: string | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  @Field(() => Float, { nullable: true })
  weightInTerm?: number;

  @IsOptional()
  @IsString()
  @Field(() => String, { nullable: true })
  description?: string | null;
}

// ── Datesheet (schedules) ────────────────────────────────────────────────────

@InputType({ description: 'Add a datesheet row to an exam.' })
export class CreateExamScheduleInput {
  @IsUUID()
  @Field(() => ID)
  examId!: string;

  @IsUUID()
  @Field(() => ID)
  sectionId!: string;

  @IsUUID()
  @Field(() => ID)
  subjectId!: string;

  @IsIn(ASSESSMENT_COMPONENT_VALUES)
  @Field(() => AssessmentComponent)
  component!: AssessmentComponent;

  @IsOptional()
  @IsDateString()
  @Field(() => String, { nullable: true })
  examDate?: string | null;

  @IsOptional()
  @Matches(TIME_REGEX, { message: 'startTime must be HH:mm' })
  @Field(() => String, { nullable: true })
  startTime?: string | null;

  @IsOptional()
  @Matches(TIME_REGEX, { message: 'endTime must be HH:mm' })
  @Field(() => String, { nullable: true })
  endTime?: string | null;

  @IsNumber()
  @Min(1)
  @Field(() => Float)
  maxMarks!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Field(() => Float, { nullable: true })
  passMarks?: number | null;

  @IsOptional()
  @IsString()
  @Field(() => String, { nullable: true })
  room?: string | null;

  @IsOptional()
  @IsUUID()
  @Field(() => ID, { nullable: true })
  invigilatorId?: string | null;
}

@InputType()
export class UpdateExamScheduleInput {
  @IsOptional()
  @IsIn(ASSESSMENT_COMPONENT_VALUES)
  @Field(() => AssessmentComponent, { nullable: true })
  component?: AssessmentComponent;

  @IsOptional()
  @IsDateString()
  @Field(() => String, { nullable: true })
  examDate?: string | null;

  @IsOptional()
  @Matches(TIME_REGEX)
  @Field(() => String, { nullable: true })
  startTime?: string | null;

  @IsOptional()
  @Matches(TIME_REGEX)
  @Field(() => String, { nullable: true })
  endTime?: string | null;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Field(() => Float, { nullable: true })
  maxMarks?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Field(() => Float, { nullable: true })
  passMarks?: number | null;

  @IsOptional()
  @IsString()
  @Field(() => String, { nullable: true })
  room?: string | null;

  @IsOptional()
  @IsUUID()
  @Field(() => ID, { nullable: true })
  invigilatorId?: string | null;
}

// ── Marks entry ────────────────────────────────────────────────────────────────

@InputType({ description: "One student's marks for a datesheet row." })
export class ExamMarkInput {
  @IsUUID()
  @Field(() => ID)
  examScheduleId!: string;

  @IsUUID()
  @Field(() => ID, { description: 'Student membership id.' })
  studentId!: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Field(() => Float, { nullable: true, description: 'Null when absent / not entered.' })
  obtainedMarks?: number | null;

  @IsOptional()
  @IsBoolean()
  @Field(() => Boolean, { nullable: true })
  isAbsent?: boolean;

  @IsOptional()
  @IsBoolean()
  @Field(() => Boolean, { nullable: true })
  isExempted?: boolean;

  @IsOptional()
  @IsString()
  @Field(() => String, { nullable: true })
  remarks?: string | null;
}

@InputType({ description: 'Bulk-enter marks for an exam (must be in MARKS_ENTRY).' })
export class EnterMarksInput {
  @IsUUID()
  @Field(() => ID)
  examId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ExamMarkInput)
  @Field(() => [ExamMarkInput])
  marks!: ExamMarkInput[];
}

// ── Replace grade bands ──────────────────────────────────────────────────────

@InputType({ description: 'Replace all bands of a grade scheme.' })
export class ReplaceGradeBandsInput {
  @IsUUID()
  @Field(() => ID)
  gradingSchemeId!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GradeBandInputDto)
  @Field(() => [GradeBandInputDto])
  bands!: GradeBandInputDto[];
}

// ── NEP topics ─────────────────────────────────────────────────────────────────

@InputType({ description: 'Create a NEP learning outcome / topic for a subject.' })
export class CreateSubjectTopicInput {
  @IsUUID()
  @Field(() => ID)
  subjectId!: string;

  @IsOptional()
  @IsUUID()
  @Field(() => ID, { nullable: true })
  standardId?: string | null;

  @IsNotEmpty()
  @Field(() => I18nTextScalar)
  name!: Record<string, string>;

  @IsOptional()
  @IsString()
  @Field(() => String, { nullable: true })
  code?: string | null;

  @IsOptional()
  @IsString()
  @Field(() => String, { nullable: true })
  learningOutcome?: string | null;

  @IsOptional()
  @IsInt()
  @Field(() => Int, { nullable: true })
  sequence?: number;
}

@InputType({ description: "One student's competency for a topic in an exam." })
export class TopicAssessmentInput {
  @IsUUID()
  @Field(() => ID)
  examScheduleId!: string;

  @IsUUID()
  @Field(() => ID)
  studentId!: string;

  @IsUUID()
  @Field(() => ID)
  subjectTopicId!: string;

  @IsIn(COMPETENCY_LEVEL_VALUES)
  @Field(() => CompetencyLevel)
  competencyLevel!: CompetencyLevel;

  @IsOptional()
  @IsString()
  @Field(() => String, { nullable: true })
  descriptor?: string | null;
}

@InputType({ description: 'Bulk-enter NEP topic assessments.' })
export class EnterTopicAssessmentsInput {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => TopicAssessmentInput)
  @Field(() => [TopicAssessmentInput])
  assessments!: TopicAssessmentInput[];
}

// ── Co-scholastic ────────────────────────────────────────────────────────────────

@InputType({ description: 'Create a co-scholastic domain.' })
export class CreateCoScholasticAreaInput {
  @IsNotEmpty()
  @Field(() => I18nTextScalar)
  name!: Record<string, string>;

  @IsOptional()
  @IsUUID()
  @Field(() => ID, { nullable: true, description: 'CO_SCHOLASTIC grade scheme.' })
  gradingSchemeId?: string | null;

  @IsOptional()
  @IsInt()
  @Field(() => Int, { nullable: true })
  sequence?: number;
}

@InputType({ description: "One student's co-scholastic grade for a term." })
export class CoScholasticAssessmentInput {
  @IsUUID()
  @Field(() => ID)
  coScholasticAreaId!: string;

  @IsUUID()
  @Field(() => ID)
  studentId!: string;

  @IsUUID()
  @Field(() => ID)
  examTermId!: string;

  @IsString()
  @IsNotEmpty()
  @Field(() => String)
  grade!: string;

  @IsOptional()
  @IsString()
  @Field(() => String, { nullable: true })
  descriptor?: string | null;
}

@InputType({ description: 'Bulk-enter co-scholastic grades.' })
export class EnterCoScholasticInput {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CoScholasticAssessmentInput)
  @Field(() => [CoScholasticAssessmentInput])
  assessments!: CoScholasticAssessmentInput[];
}

// ── Report cards ────────────────────────────────────────────────────────────────

@InputType({ description: 'Create a report-card template.' })
export class CreateReportCardInput {
  @IsUUID()
  @Field(() => ID)
  academicYearId!: string;

  @IsOptional()
  @IsUUID()
  @Field(() => ID, { nullable: true, description: 'Term to aggregate; null = annual.' })
  examTermId?: string | null;

  @IsNotEmpty()
  @Field(() => I18nTextScalar)
  name!: Record<string, string>;

  @IsOptional()
  @IsUUID()
  @Field(() => ID, { nullable: true })
  gradingSchemeId?: string | null;

  @IsOptional()
  @IsBoolean()
  @Field(() => Boolean, { nullable: true })
  includeAttendance?: boolean;

  @IsOptional()
  @IsBoolean()
  @Field(() => Boolean, { nullable: true })
  includeCoScholastic?: boolean;

  @IsOptional()
  @IsBoolean()
  @Field(() => Boolean, { nullable: true })
  includeTopicWise?: boolean;
}

@InputType()
export class UpdateReportCardInput {
  @IsOptional()
  @IsNotEmpty()
  @Field(() => I18nTextScalar, { nullable: true })
  name?: Record<string, string>;

  @IsOptional()
  @IsUUID()
  @Field(() => ID, { nullable: true })
  examTermId?: string | null;

  @IsOptional()
  @IsUUID()
  @Field(() => ID, { nullable: true })
  gradingSchemeId?: string | null;

  @IsOptional()
  @IsBoolean()
  @Field(() => Boolean, { nullable: true })
  includeAttendance?: boolean;

  @IsOptional()
  @IsBoolean()
  @Field(() => Boolean, { nullable: true })
  includeCoScholastic?: boolean;

  @IsOptional()
  @IsBoolean()
  @Field(() => Boolean, { nullable: true })
  includeTopicWise?: boolean;
}
