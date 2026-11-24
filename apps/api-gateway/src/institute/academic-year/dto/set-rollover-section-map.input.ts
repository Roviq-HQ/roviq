import { Field, ID, InputType } from '@nestjs/graphql';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsOptional,
  IsUUID,
  ValidateNested,
} from 'class-validator';

@InputType({
  description:
    'Where the year rollover sends the students of one section of the active year, in place of the section with the same name.',
})
export class RolloverSectionMapEntryInput {
  @IsUUID()
  @Field(() => ID, { description: 'A section of the currently active year.' })
  fromSectionId!: string;

  @IsOptional()
  @IsUUID()
  @Field(() => ID, {
    nullable: true,
    description:
      "A section of the year being activated. Used only for students whose class in that year is this section's class. Null removes the override.",
  })
  toSectionId?: string | null;
}

@InputType({
  description:
    'Sets the override of each section named in entries and leaves the other sections as they are.',
})
export class SetRolloverSectionMapInput {
  @IsUUID()
  @Field(() => ID, { description: 'The year that will be activated. Not the active year.' })
  academicYearId!: string;

  @IsArray()
  @ArrayMaxSize(500)
  @ArrayUnique((entry: RolloverSectionMapEntryInput) => entry.fromSectionId)
  @ValidateNested({ each: true })
  @Type(() => RolloverSectionMapEntryInput)
  @Field(() => [RolloverSectionMapEntryInput], {
    description: 'At most 500 entries, each source section once.',
  })
  entries!: RolloverSectionMapEntryInput[];
}
