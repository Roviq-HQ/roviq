import { Field, InputType } from '@nestjs/graphql';
import { IsIn, IsOptional } from 'class-validator';

@InputType()
export class UpdateLocaleInput {
  @Field(() => String, {
    nullable: true,
    description: 'en or hi; null restores browser language detection.',
  })
  @IsOptional()
  @IsIn(['en', 'hi'])
  locale?: string | null;
}
