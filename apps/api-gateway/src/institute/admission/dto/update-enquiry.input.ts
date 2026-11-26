import { Field, ID, InputType } from '@nestjs/graphql';
import { EnquirySource, EnquiryStatus } from '@roviq/common-types';
import {
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';

@InputType({
  description:
    'Fields that can be updated on an existing admission enquiry. All fields are optional; ' +
    'studentName, classRequested, parentName and parentPhone may be left out but not cleared.',
})
export class UpdateEnquiryInput {
  @Field({ nullable: true, description: 'Name of the prospective student.' })
  @ValidateIf((_, value) => value !== undefined)
  @IsNotEmpty()
  @IsString()
  @MaxLength(200)
  studentName?: string;

  @Field({
    nullable: true,
    description:
      'Requested class or grade, e.g. "Nursery", "LKG", "Class 5"; at most 20 characters.',
  })
  @ValidateIf((_, value) => value !== undefined)
  @IsNotEmpty()
  @IsString()
  @MaxLength(20)
  classRequested?: string;

  @Field({
    nullable: true,
    description: 'Name of the parent or guardian who submitted the enquiry.',
  })
  @ValidateIf((_, value) => value !== undefined)
  @IsNotEmpty()
  @IsString()
  @MaxLength(200)
  parentName?: string;

  @Field({ nullable: true, description: '10-digit Indian mobile number (without +91 prefix).' })
  @ValidateIf((_, value) => value !== undefined)
  @IsNotEmpty()
  @IsString()
  @Matches(/^[6-9]\d{9}$/, {
    message: 'parentPhone must be a 10-digit Indian mobile starting with 6-9',
  })
  parentPhone?: string;

  @Field({ nullable: true, description: 'Parent contact email address.' })
  @IsOptional()
  @IsEmail()
  @MaxLength(320)
  parentEmail?: string;

  @Field(() => EnquiryStatus, { nullable: true, description: 'Lifecycle status of this enquiry.' })
  @IsOptional()
  @IsEnum(EnquiryStatus)
  status?: EnquiryStatus;

  @Field({ nullable: true, description: 'Scheduled follow-up date (ISO date YYYY-MM-DD).' })
  @IsOptional()
  @IsDateString()
  followUpDate?: string;

  @Field(() => ID, {
    nullable: true,
    description: 'Staff member responsible for following up on this enquiry.',
  })
  @IsOptional()
  @IsUUID()
  assignedTo?: string;

  @Field({ nullable: true, description: 'Internal notes for the admissions team.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @Field(() => EnquirySource, {
    nullable: true,
    description: 'Channel through which this enquiry was received.',
  })
  @IsOptional()
  @IsEnum(EnquirySource)
  source?: EnquirySource;

  @Field({
    nullable: true,
    description: 'Name of the person or campaign who referred the enquiry.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  referredBy?: string;

  @Field({
    nullable: true,
    description: 'Whether the prospective student has a sibling already enrolled.',
  })
  @IsOptional()
  @IsBoolean()
  siblingInSchool?: boolean;

  @Field({
    nullable: true,
    description: 'Admission number of the enrolled sibling (if siblingInSchool is true).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  siblingAdmissionNo?: string;

  @Field({ nullable: true, description: 'Any special educational needs or disabilities to note.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  specialNeeds?: string;
}
