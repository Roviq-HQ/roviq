import { ArgsType, Field, ID, InputType, Int } from '@nestjs/graphql';
import { AuditMask } from '@roviq/audit';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

const E164 = /^\+[1-9]\d{6,14}$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const TOKEN_MAX_LENGTH = 4096;

@InputType({ description: "Registers the platform's sender, or one institute's own." })
export class RegisterMessagingSenderInput {
  @Field(() => ID, {
    nullable: true,
    description:
      "The institute whose own sender this is. Absent or null registers the platform's sender.",
  })
  @IsOptional()
  @IsUUID()
  tenantId?: string | null;

  @Field({ description: "The provider's id of the number." })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  providerNumberId!: string;

  @Field({
    description: 'The number as people see it: E.164 with a leading +, e.g. +919876543210.',
  })
  @Matches(E164, { message: 'displayNumber must be E.164 with a leading +' })
  displayNumber!: string;

  @Field({ description: 'Provider access token. Stored encrypted; never returned or logged.' })
  @IsString()
  @MinLength(1)
  @MaxLength(TOKEN_MAX_LENGTH)
  @AuditMask()
  accessToken!: string;

  @Field(() => Int, { description: 'Messages the sender may send in any 24 hours (at least 1).' })
  @IsInt()
  @Min(1)
  dailyCap!: number;

  @Field(() => Int, {
    nullable: true,
    description:
      "Only on the platform's sender: what one institute may use of dailyCap (at least 1). Refused on an institute's sender.",
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  instituteDailyCap?: number | null;
}

@InputType({ description: 'Fields to change on a sender; an absent field is left as it is.' })
export class UpdateMessagingSenderInput {
  @Field({ nullable: true, description: 'E.164 with a leading +.' })
  @ValidateIf((_, value) => value !== undefined)
  @Matches(E164, { message: 'displayNumber must be E.164 with a leading +' })
  displayNumber?: string;

  @Field(() => Int, { nullable: true, description: 'At least 1.' })
  @ValidateIf((_, value) => value !== undefined)
  @IsInt()
  @Min(1)
  dailyCap?: number;

  @Field(() => Int, {
    nullable: true,
    description:
      "Only on the platform's sender: at least 1, or null to remove the share limit. Refused on an institute's sender.",
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  instituteDailyCap?: number | null;
}

@ArgsType()
export class RotateMessagingSenderTokenArgs {
  @Field(() => ID)
  @IsUUID()
  id!: string;

  @Field({
    description: 'The new provider access token. Stored encrypted; never returned or logged.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(TOKEN_MAX_LENGTH)
  @AuditMask()
  accessToken!: string;
}

@ArgsType()
export class WhatsAppUsageArgs {
  @Field({ description: 'Calendar month as YYYY-MM, in India time (Asia/Kolkata).' })
  @Matches(MONTH, { message: 'month must be YYYY-MM' })
  month!: string;
}
