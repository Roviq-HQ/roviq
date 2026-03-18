import { Field, InputType } from '@nestjs/graphql';
import { IsNotEmpty, IsString } from 'class-validator';

@InputType()
export class RegisterDeviceTokenInput {
  @IsString()
  @IsNotEmpty()
  @Field()
  token!: string;
}
