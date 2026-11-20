import { Field, ID, InputType } from '@nestjs/graphql';
import { LeaveType } from '@roviq/common-types';
import { DateOnlyScalar } from '@roviq/nestjs-graphql';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

@InputType({ description: 'Edit a PENDING leave — dates, type, reason, or supporting files.' })
export class UpdateLeaveInput {
  @IsOptional()
  @IsString()
  @Field(() => DateOnlyScalar, { nullable: true })
  startDate?: string;

  @IsOptional()
  @IsString()
  @Field(() => DateOnlyScalar, { nullable: true })
  endDate?: string;

  @IsOptional()
  @IsEnum(LeaveType)
  @Field(() => LeaveType, { nullable: true })
  type?: LeaveType;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  @Field(() => String, { nullable: true })
  reason?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsUUID(undefined, { each: true })
  @Field(() => [ID], {
    nullable: true,
    description:
      'Full new set of attachments: ids already attached stay, missing ones are removed, new ones (uploaded with purpose LEAVE_ATTACHMENT) are added. Omit to leave attachments unchanged.',
  })
  fileIds?: string[];
}
