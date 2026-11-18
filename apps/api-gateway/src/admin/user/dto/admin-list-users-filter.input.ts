import { Field, InputType, Int } from '@nestjs/graphql';
import { DateTimeScalar } from '@roviq/nestjs-graphql';
import {
  IsArray,
  IsBoolean,
  IsDate,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { UserStatusEnum } from '../models/admin-user.model';

@InputType({ description: 'Filters for the adminListUsers query' })
export class AdminListUsersFilterInput {
  @Field({
    nullable: true,
    description: 'Matches profile name (prefix), username, email or phone number',
  })
  @IsString()
  @IsOptional()
  search?: string;

  @Field(() => [UserStatusEnum], { nullable: true })
  @IsArray()
  @IsEnum(UserStatusEnum, { each: true })
  @IsOptional()
  status?: UserStatusEnum[];

  @Field({
    nullable: true,
    description: 'true: only users with an institute membership; false: only users without one',
  })
  @IsBoolean()
  @IsOptional()
  hasInstituteMembership?: boolean;

  @Field({
    nullable: true,
    description: 'true: only platform (Roviq staff) members; false: only non-members',
  })
  @IsBoolean()
  @IsOptional()
  hasPlatformMembership?: boolean;

  @Field({
    nullable: true,
    description: 'true: only reseller team members; false: only non-members',
  })
  @IsBoolean()
  @IsOptional()
  hasResellerMembership?: boolean;

  @Field({
    nullable: true,
    description: 'Return only users with at least one membership in this institute (tenant id)',
  })
  @IsUUID()
  @IsOptional()
  tenantId?: string;

  @Field(() => DateTimeScalar, { nullable: true, description: 'Created at or after (inclusive)' })
  @IsDate()
  @IsOptional()
  createdAfter?: Date;

  @Field(() => DateTimeScalar, { nullable: true, description: 'Created at or before (inclusive)' })
  @IsDate()
  @IsOptional()
  createdBefore?: Date;

  @Field(() => Int, { nullable: true, defaultValue: 20 })
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  first?: number;

  @Field({ nullable: true, description: 'Cursor from a previous page (newest first)' })
  @IsString()
  @IsOptional()
  after?: string;
}
