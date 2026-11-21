import { Field, ObjectType } from '@nestjs/graphql';
import type { TcStatus } from '@roviq/common-types';
import type { I18nContent } from '@roviq/database';
import { I18nTextScalar } from '@roviq/nestjs-graphql';

/** What the public verification page may show for a token. */
export interface TcVerificationRow {
  serialNumber: string;
  status: TcStatus;
  studentName: string | null;
  instituteName: I18nContent;
  issuedOn: string | null;
  isDuplicate: boolean;
}

@ObjectType({ description: 'What the public verification page shows for a TC' })
export class TcVerificationModel {
  @Field()
  serialNumber!: string;

  @Field(() => Boolean, { description: 'False when the TC was cancelled or is not issued' })
  isValid!: boolean;

  @Field(() => String, { nullable: true })
  studentName!: string | null;

  @Field(() => I18nTextScalar, { description: 'Institute name by locale' })
  instituteName!: Record<string, string>;

  @Field(() => String, { nullable: true, description: 'Issue date, YYYY-MM-DD' })
  issuedOn!: string | null;

  @Field(() => Boolean)
  isDuplicate!: boolean;
}
