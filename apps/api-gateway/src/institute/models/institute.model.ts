import { Field, ID, ObjectType, registerEnumType } from '@nestjs/graphql';
import type { InstituteAddress, InstituteContact } from '@roviq/database';
import GraphQLJSON from 'graphql-type-json';

export enum InstituteTypeEnum {
  SCHOOL = 'SCHOOL',
  COACHING = 'COACHING',
  LIBRARY = 'LIBRARY',
}

export enum StructureFrameworkEnum {
  NEP = 'NEP',
  TRADITIONAL = 'TRADITIONAL',
}

export enum SetupStatusEnum {
  PENDING = 'PENDING',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

export enum InstituteStatusEnum {
  PENDING = 'PENDING',
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  SUSPENDED = 'SUSPENDED',
  REJECTED = 'REJECTED',
}

registerEnumType(InstituteTypeEnum, { name: 'InstituteType' });
registerEnumType(StructureFrameworkEnum, { name: 'StructureFramework' });
registerEnumType(SetupStatusEnum, { name: 'SetupStatus' });
registerEnumType(InstituteStatusEnum, { name: 'InstituteStatus' });

@ObjectType()
export class InstituteModel {
  @Field(() => ID)
  id!: string;

  @Field(() => GraphQLJSON)
  name!: Record<string, string>;

  @Field()
  slug!: string;

  @Field({ nullable: true })
  code?: string | null;

  @Field(() => InstituteTypeEnum)
  type!: string;

  @Field(() => StructureFrameworkEnum)
  structureFramework!: string;

  @Field(() => SetupStatusEnum)
  setupStatus!: string;

  @Field(() => GraphQLJSON)
  contact!: InstituteContact;

  @Field(() => GraphQLJSON, { nullable: true })
  address?: InstituteAddress | null;

  @Field({ nullable: true })
  logoUrl?: string | null;

  @Field()
  timezone!: string;

  @Field()
  currency!: string;

  @Field(() => GraphQLJSON)
  settings!: Record<string, unknown>;

  @Field(() => InstituteStatusEnum)
  status!: string;

  @Field()
  createdAt!: Date;

  @Field()
  updatedAt!: Date;
}
