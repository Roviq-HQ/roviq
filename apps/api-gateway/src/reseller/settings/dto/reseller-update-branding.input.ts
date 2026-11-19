import { Field, ID, InputType, Int } from '@nestjs/graphql';
import {
  findForbiddenCustomCss,
  RESELLER_BRAND_COLOR_RE,
  RESELLER_CUSTOM_CSS_MAX_LENGTH,
  ResellerBrandingTheme,
} from '@roviq/common-types';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  registerDecorator,
  type ValidationArguments,
} from 'class-validator';

/** Refuses a stylesheet that could load something from another server or leave its style element. */
function IsSafeCustomCss() {
  return (target: object, propertyName: string) => {
    registerDecorator({
      name: 'isSafeCustomCss',
      target: target.constructor,
      propertyName,
      validator: {
        validate: (value: unknown) =>
          typeof value === 'string' && findForbiddenCustomCss(value) === null,
        defaultMessage: (args: ValidationArguments) =>
          `customCss must not contain ${
            typeof args.value === 'string' ? findForbiddenCustomCss(args.value) : 'non-text values'
          }`,
      },
    });
  };
}

@InputType({
  description:
    'Payload for resellerUpdateBranding. An omitted field is left as it is; null resets it to the default.',
})
export class ResellerUpdateBrandingInput {
  @Field(() => Int, {
    description: 'Optimistic concurrency version — must match the current server value',
  })
  @IsInt()
  version!: number;

  @Field(() => String, { nullable: true, description: 'Six-digit hex colour, e.g. "#1677FF"' })
  @Matches(RESELLER_BRAND_COLOR_RE)
  @IsOptional()
  primaryColor?: string | null;

  @Field(() => String, { nullable: true, description: 'Six-digit hex colour, e.g. "#5BC0EB"' })
  @Matches(RESELLER_BRAND_COLOR_RE)
  @IsOptional()
  secondaryColor?: string | null;

  @Field(() => ResellerBrandingTheme, { nullable: true })
  @IsEnum(ResellerBrandingTheme)
  @IsOptional()
  theme?: ResellerBrandingTheme | null;

  @Field(() => String, {
    nullable: true,
    description: `Extra stylesheet, at most ${RESELLER_CUSTOM_CSS_MAX_LENGTH} characters. Refused if it contains a backslash, "<", @import, url(), image(), image-set(), expression() or javascript:.`,
  })
  @IsString()
  @MaxLength(RESELLER_CUSTOM_CSS_MAX_LENGTH)
  @IsSafeCustomCss()
  @IsOptional()
  customCss?: string | null;

  @Field(() => ID, {
    nullable: true,
    description:
      'A finished RESELLER_LOGO upload from resellerRequestFileUpload. null removes the logo; the replaced file is deleted.',
  })
  @IsUUID()
  @IsOptional()
  logoFileId?: string | null;

  @Field(() => ID, {
    nullable: true,
    description:
      'A finished RESELLER_FAVICON upload from resellerRequestFileUpload. null removes the favicon; the replaced file is deleted.',
  })
  @IsUUID()
  @IsOptional()
  faviconFileId?: string | null;
}
