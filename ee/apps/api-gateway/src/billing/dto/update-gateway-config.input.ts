import { Field, InputType } from '@nestjs/graphql';
import { AuditMask } from '@roviq/audit';
import { GatewayConfigStatus } from '@roviq/ee-billing-types';
import { IsBoolean, IsOptional, IsString } from 'class-validator';
import { GraphQLJSON } from 'graphql-type-json';

@InputType()
export class UpdateGatewayConfigInput {
  @Field({ nullable: true })
  @IsString()
  @IsOptional()
  displayName?: string;

  @Field(() => GraphQLJSON, { nullable: true })
  @IsOptional()
  @AuditMask()
  credentials?: Record<string, string>;

  @Field({ nullable: true })
  @IsString()
  @IsOptional()
  @AuditMask()
  webhookSecret?: string;

  @Field({ nullable: true })
  @IsBoolean()
  @IsOptional()
  isDefault?: boolean;

  @Field({ nullable: true })
  @IsBoolean()
  @IsOptional()
  testMode?: boolean;

  @Field(() => [String], { nullable: true })
  @IsOptional()
  supportedMethods?: string[];

  @Field(() => GatewayConfigStatus, { nullable: true })
  @IsOptional()
  status?: GatewayConfigStatus;
}
