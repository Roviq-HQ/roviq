import { Field, InputType } from '@nestjs/graphql';
import { IsOptional, IsString } from 'class-validator';

@InputType()
export class UpdateInstituteBrandingInput {
  @Field({ nullable: true })
  @IsString()
  @IsOptional()
  logoUrl?: string;

  @Field({ nullable: true })
  @IsString()
  @IsOptional()
  faviconUrl?: string;

  @Field({ nullable: true })
  @IsString()
  @IsOptional()
  primaryColor?: string;

  @Field({ nullable: true })
  @IsString()
  @IsOptional()
  secondaryColor?: string;

  @Field({ nullable: true })
  @IsString()
  @IsOptional()
  themeIdentifier?: string;

  @Field({ nullable: true })
  @IsString()
  @IsOptional()
  coverImageUrl?: string;
}
