import { Field, ID, InputType } from '@nestjs/graphql';
import { IsHexColor, IsOptional, IsString, IsUUID } from 'class-validator';

@InputType({
  description:
    'Visual branding fields for the institute portal. All fields are optional. Upload images first with `requestFileUpload`.',
})
export class UpdateInstituteBrandingInput {
  @Field(() => ID, {
    nullable: true,
    description:
      'Logo shown in the portal header: the id of an upload with purpose INSTITUTE_LOGO. Null removes the logo; leave out to keep it.',
  })
  @IsOptional()
  @IsUUID()
  logoFileId?: string | null;

  @Field(() => ID, {
    nullable: true,
    description:
      'Browser-tab icon: the id of an upload with purpose INSTITUTE_FAVICON. Null removes it; leave out to keep it.',
  })
  @IsOptional()
  @IsUUID()
  faviconFileId?: string | null;

  @Field({
    nullable: true,
    description:
      'Primary brand colour in hex format, e.g. "#1677FF". Used for buttons, links, and highlights.',
  })
  @IsString()
  @IsHexColor()
  @IsOptional()
  primaryColor?: string;

  @Field({
    nullable: true,
    description:
      'Secondary brand colour in hex format, e.g. "#5BC0EB". Used for accents and secondary actions.',
  })
  @IsString()
  @IsHexColor()
  @IsOptional()
  secondaryColor?: string;

  @Field({
    nullable: true,
    description: 'Theme identifier key for switching between pre-built UI theme presets.',
  })
  @IsString()
  @IsOptional()
  themeIdentifier?: string;

  @Field(() => ID, {
    nullable: true,
    description:
      'Banner shown on the login page: the id of an upload with purpose INSTITUTE_COVER. Null removes it; leave out to keep it.',
  })
  @IsOptional()
  @IsUUID()
  coverImageFileId?: string | null;
}
