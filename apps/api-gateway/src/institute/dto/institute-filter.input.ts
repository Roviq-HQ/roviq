import { Field, InputType, Int } from '@nestjs/graphql';
import { InstituteStatusEnum, InstituteTypeEnum } from '../models/institute.model';

@InputType()
export class InstituteFilterInput {
  @Field({ nullable: true })
  search?: string;

  @Field(() => InstituteStatusEnum, { nullable: true })
  status?: string;

  @Field(() => InstituteTypeEnum, { nullable: true })
  type?: string;

  @Field(() => Int, { nullable: true, defaultValue: 20 })
  first?: number;

  @Field({ nullable: true })
  after?: string;
}
