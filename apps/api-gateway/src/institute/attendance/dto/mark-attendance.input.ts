import { Field, ID, InputType } from '@nestjs/graphql';
import { AttendanceMode, AttendanceStatus } from '@roviq/common-types';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';

@InputType({
  description:
    "Set a single student's attendance status for a session. Upserts — creating the entry if missing or updating otherwise.",
})
export class MarkAttendanceInput {
  @IsUUID()
  @Field(() => ID)
  sessionId!: string;

  @IsUUID()
  @Field(() => ID, {
    description:
      "The student's membership id in this institute (`membershipId` of the student), not the student profile id. The student must be enrolled in the session's section.",
  })
  studentId!: string;

  @IsEnum(AttendanceStatus)
  @Field(() => AttendanceStatus)
  status!: AttendanceStatus;

  @IsOptional()
  @IsEnum(AttendanceMode)
  @Field(() => AttendanceMode, { nullable: true, defaultValue: 'MANUAL' })
  mode?: AttendanceMode;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Field(() => String, { nullable: true })
  remarks?: string | null;
}

@InputType()
export class MarkAttendanceItem {
  @IsUUID()
  @Field(() => ID, {
    description:
      "The student's membership id in this institute (`membershipId` of the student), not the student profile id. The student must be enrolled in the session's section.",
  })
  studentId!: string;

  @IsEnum(AttendanceStatus)
  @Field(() => AttendanceStatus)
  status!: AttendanceStatus;

  @IsOptional()
  @IsEnum(AttendanceMode)
  @Field(() => AttendanceMode, { nullable: true, defaultValue: 'MANUAL' })
  mode?: AttendanceMode;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Field(() => String, { nullable: true })
  remarks?: string | null;
}

@InputType({
  description: 'Bulk mark multiple students in one session. Useful for end-of-class submission.',
})
export class BulkMarkAttendanceInput {
  @IsUUID()
  @Field(() => ID)
  sessionId!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MarkAttendanceItem)
  @Field(() => [MarkAttendanceItem])
  entries!: MarkAttendanceItem[];
}
