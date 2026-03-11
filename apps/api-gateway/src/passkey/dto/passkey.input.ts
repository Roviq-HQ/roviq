import { Field, InputType } from '@nestjs/graphql';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { GraphQLJSON } from 'graphql-type-json';

@InputType()
export class GeneratePasskeyRegistrationInput {
  @Field()
  @IsString()
  @IsNotEmpty()
  password!: string;
}

@InputType()
export class VerifyPasskeyRegistrationInput {
  @Field(() => GraphQLJSON)
  @IsNotEmpty()
  credential!: Record<string, unknown>;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;
}

@InputType()
export class VerifyPasskeyAuthInput {
  @Field()
  @IsString()
  @IsNotEmpty()
  challengeId!: string;

  @Field(() => GraphQLJSON)
  @IsNotEmpty()
  credential!: Record<string, unknown>;
}
