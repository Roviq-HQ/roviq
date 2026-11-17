import { Field, InputType, Int } from '@nestjs/graphql';
import { ArrayNotEmpty, ArrayUnique, IsArray, IsInt, IsString, Min } from 'class-validator';

@InputType()
export class UpdateInstituteLocalesInput {
  @Field(() => [String])
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsString({ each: true })
  supportedLocales!: string[];

  @Field()
  @IsString()
  defaultLocale!: string;

  @Field(() => Int, { description: 'Current institute version for optimistic concurrency.' })
  @IsInt()
  @Min(1)
  version!: number;
}
