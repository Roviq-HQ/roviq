import { Field, ID, ObjectType } from '@nestjs/graphql';
import { InstituteStatus } from '@roviq/common-types';
import { DateTimeScalar, I18nTextScalar } from '@roviq/nestjs-graphql';

@ObjectType({ description: 'A deleted institute, as listed for restoring' })
export class DeletedInstituteModel {
  @Field(() => ID)
  id!: string;

  @Field(() => I18nTextScalar)
  name!: Record<string, string>;

  @Field(() => String, { nullable: true })
  code!: string | null;

  @Field()
  slug!: string;

  @Field(() => InstituteStatus, { description: 'The status it returns to when restored' })
  status!: InstituteStatus;

  @Field(() => DateTimeScalar)
  deletedAt!: Date;
}
