import { Field, ID, InputType } from '@nestjs/graphql';
import { PromotionStatus } from '@roviq/common-types';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsUUID } from 'class-validator';

/** TRANSFERRED is set by the transfer certificate flow only. */
export const DECIDABLE_PROMOTION_STATUSES = [
  PromotionStatus.PENDING,
  PromotionStatus.PROMOTED,
  PromotionStatus.DETAINED,
  PromotionStatus.GRADUATED,
] as const;

@InputType({ description: 'Records the year-end result on student year records.' })
export class SetPromotionDecisionsInput {
  @Field(() => [ID], { description: '1 to 500 student year record ids (studentAcademicId).' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  studentAcademicIds!: string[];

  @Field(() => PromotionStatus, {
    description: 'PENDING, PROMOTED, DETAINED or GRADUATED. TRANSFERRED is refused.',
  })
  @IsIn(DECIDABLE_PROMOTION_STATUSES)
  status!: PromotionStatus;
}
