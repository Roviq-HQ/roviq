import { Field, InputType, Int } from '@nestjs/graphql';
import { IsBoolean, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

@InputType({ description: 'Filters for the resellerListTeamMembers query' })
export class ResellerTeamFilterInput {
  @Field({ nullable: true, description: 'Search against Roviq ID, email, first name or last name' })
  @IsString()
  @IsOptional()
  search?: string;

  @Field(() => Boolean, {
    nullable: true,
    description: 'Only active (true) or only deactivated (false) members; omit for both',
  })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @Field(() => Int, { nullable: true, defaultValue: 20 })
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  first?: number;

  @Field({ nullable: true, description: 'Relay-cursor for forward pagination' })
  @IsString()
  @IsOptional()
  after?: string;
}
