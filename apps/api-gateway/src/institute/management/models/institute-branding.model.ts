import { Field, ID, ObjectType } from '@nestjs/graphql';

@ObjectType({
  description:
    'Visual branding of an institute. `logo`, `favicon` and `coverImage` are public images.',
})
export class InstituteBrandingModel {
  @Field(() => ID)
  id!: string;

  logoFileId?: string | null;
  faviconFileId?: string | null;
  coverImageFileId?: string | null;

  @Field(() => String, { nullable: true })
  primaryColor?: string | null;

  @Field(() => String, { nullable: true })
  secondaryColor?: string | null;

  @Field(() => String, { nullable: true })
  themeIdentifier?: string | null;
}
