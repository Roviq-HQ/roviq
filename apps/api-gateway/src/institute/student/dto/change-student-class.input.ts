import { Field, ID, InputType } from '@nestjs/graphql';
import { IsOptional, IsString, IsUUID } from 'class-validator';

@InputType({
  description:
    "Moves a student to another class and section of the same academic year. Last year's result follows: PROMOTED to the new class when it is higher, DETAINED when it is the same level.",
})
export class ChangeStudentClassInput {
  @Field(() => ID, { description: 'The student year record (studentAcademicId) to move.' })
  @IsUUID()
  studentAcademicId!: string;

  @Field(() => ID, { description: 'A standard of the same academic year as the record.' })
  @IsUUID()
  standardId!: string;

  @Field(() => ID, { description: 'A section of that standard.' })
  @IsUUID()
  sectionId!: string;

  @Field({ nullable: true, description: 'Required reason when overriding capacity hard limit' })
  @IsOptional()
  @IsString()
  overrideReason?: string;
}
