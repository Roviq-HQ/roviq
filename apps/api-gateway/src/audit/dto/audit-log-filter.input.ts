import { Field, InputType } from '@nestjs/graphql';
import { IsOptional, IsUUID, MaxLength } from 'class-validator';

@InputType()
export class DateRangeInput {
  @Field()
  from!: Date;

  @Field()
  to!: Date;
}

@InputType()
export class AuditLogFilterInput {
  @Field(() => String, { nullable: true })
  @IsOptional()
  @MaxLength(80)
  entityType?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsUUID()
  entityId?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsUUID()
  userId?: string;

  @Field(() => [String], { nullable: true })
  @IsOptional()
  actionTypes?: string[];

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsUUID()
  correlationId?: string;

  @Field(() => DateRangeInput, { nullable: true })
  @IsOptional()
  dateRange?: DateRangeInput;
}
