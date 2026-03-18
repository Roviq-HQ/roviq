import { Field, InputType, Int } from '@nestjs/graphql';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { GroupStatusEnum, GroupTypeEnum } from '../models/institute-group.model';

@InputType()
export class InstituteGroupFilterInput {
  @Field({ nullable: true })
  @IsString()
  @IsOptional()
  search?: string;

  @Field(() => GroupStatusEnum, { nullable: true })
  @IsEnum(GroupStatusEnum)
  @IsOptional()
  status?: GroupStatusEnum;

  @Field(() => GroupTypeEnum, { nullable: true })
  @IsEnum(GroupTypeEnum)
  @IsOptional()
  type?: GroupTypeEnum;

  @Field(() => Int, { nullable: true, defaultValue: 20 })
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  first?: number;

  @Field({ nullable: true })
  @IsString()
  @IsOptional()
  after?: string;
}
