import { Field, ID, InputType } from '@nestjs/graphql';
import { LeaveType } from '@roviq/common-types';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

@InputType({ description: 'Apply for a new leave. Submits in PENDING status awaiting approval.' })
export class CreateLeaveInput {
  @IsUUID()
  @Field(() => ID, { description: 'Membership the leave is for (student or staff).' })
  userId!: string;

  @IsDateString()
  @Field(() => String, { description: 'Inclusive leave start date (ISO YYYY-MM-DD).' })
  startDate!: string;

  @IsDateString()
  @Field(() => String, { description: 'Inclusive leave end date (ISO YYYY-MM-DD).' })
  endDate!: string;

  @IsEnum(LeaveType)
  @Field(() => LeaveType)
  type!: LeaveType;

  @IsNotEmpty()
  @IsString()
  @MaxLength(1000)
  @Field(() => String, { description: 'Short explanation visible to the approver.' })
  reason!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsUUID(undefined, { each: true })
  @Field(() => [ID], {
    nullable: true,
    description:
      'Ids of files uploaded through `requestFileUpload` with purpose LEAVE_ATTACHMENT. Leaves of 3 or more calendar days need at least one.',
  })
  fileIds?: string[];
}
