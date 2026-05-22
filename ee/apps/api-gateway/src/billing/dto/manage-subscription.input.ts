import { Field, InputType } from '@nestjs/graphql';
import { IsBoolean, IsOptional, IsUUID } from 'class-validator';

@InputType()
export class ManageSubscriptionInput {
  @Field()
  @IsUUID()
  subscriptionId!: string;

  @Field({ nullable: true, defaultValue: true })
  @IsBoolean()
  @IsOptional()
  atCycleEnd?: boolean;
}
