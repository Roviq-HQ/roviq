import { Field, InputType } from '@nestjs/graphql';
import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

@InputType()
export class UpdateNotificationConfigInput {
  @IsString()
  @IsNotEmpty()
  @Field()
  notificationType!: string;

  @IsBoolean()
  @IsOptional()
  @Field({ nullable: true })
  inAppEnabled?: boolean;

  @IsBoolean()
  @IsOptional()
  @Field({ nullable: true })
  whatsappEnabled?: boolean;

  @IsBoolean()
  @IsOptional()
  @Field({ nullable: true })
  emailEnabled?: boolean;

  @IsBoolean()
  @IsOptional()
  @Field({ nullable: true })
  pushEnabled?: boolean;

  @IsBoolean()
  @IsOptional()
  @Field({ nullable: true })
  digestEnabled?: boolean;

  @IsString()
  @IsOptional()
  @Field({ nullable: true })
  digestCron?: string;
}
