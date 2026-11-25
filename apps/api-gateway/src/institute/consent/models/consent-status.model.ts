import { Field, ObjectType } from '@nestjs/graphql';
import { DateTimeScalar } from '@roviq/nestjs-graphql';
import { ConsentPurpose } from '../dto/consent.enums';

@ObjectType({ description: 'Current consent state for one purpose for one child' })
export class ConsentStatus {
  @Field({ description: 'The student profile this consent applies to' })
  studentProfileId!: string;

  @Field(() => ConsentPurpose)
  purpose!: ConsentPurpose;

  @Field({ description: 'Whether consent is currently granted' })
  isGranted!: boolean;

  @Field(() => DateTimeScalar, {
    nullable: true,
    description: 'When the consent state last changed',
  })
  lastUpdatedAt?: Date | null;
}
