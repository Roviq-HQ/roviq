import { Field, Float, ID, Int, ObjectType, registerEnumType } from '@nestjs/graphql';
import {
  InstituteStatus,
  InstituteType,
  SetupStatus,
  StructureFramework,
} from '@roviq/common-types';
import type {
  InstituteAddress as DbInstituteAddress,
  InstituteContact as DbInstituteContact,
} from '@roviq/database';
import { DateTimeScalar, I18nTextScalar } from '@roviq/nestjs-graphql';
import GraphQLJSON from 'graphql-type-json';

// ── Contact sub-types ──

@ObjectType()
export class InstitutePhoneObject {
  @Field()
  countryCode!: string;

  @Field()
  number!: string;

  @Field()
  isPrimary!: boolean;

  @Field()
  isWhatsappEnabled!: boolean;

  @Field()
  label!: string;
}

@ObjectType()
export class InstituteEmailObject {
  @Field()
  address!: string;

  @Field()
  isPrimary!: boolean;

  @Field()
  label!: string;
}

@ObjectType()
export class InstituteContactObject {
  @Field(() => [InstitutePhoneObject])
  phones!: InstitutePhoneObject[];

  @Field(() => [InstituteEmailObject])
  emails!: InstituteEmailObject[];
}

// ── Address sub-types ──

@ObjectType()
export class CoordinatesObject {
  @Field(() => Float)
  lat!: number;

  @Field(() => Float)
  lng!: number;
}

@ObjectType()
export class InstituteAddressObject {
  @Field()
  line1!: string;

  @Field({ nullable: true })
  line2?: string;

  @Field({ nullable: true })
  line3?: string;

  @Field()
  city!: string;

  @Field()
  district!: string;

  @Field()
  state!: string;

  @Field()
  postalCode!: string;

  @Field()
  country!: string;

  @Field(() => CoordinatesObject, { nullable: true })
  coordinates?: CoordinatesObject;
}

registerEnumType(InstituteType, { name: 'InstituteType' });
registerEnumType(StructureFramework, { name: 'StructureFramework' });
registerEnumType(SetupStatus, { name: 'SetupStatus' });
registerEnumType(InstituteStatus, { name: 'InstituteStatus' });

@ObjectType({ description: 'The person named to become the institute admin when setup runs.' })
export class InstituteFirstAdminObject {
  @Field(() => String, {
    nullable: true,
    description: 'Null together with lastName and phone when detailsWithheld is true.',
  })
  firstName?: string | null;

  @Field(() => String, { nullable: true })
  lastName?: string | null;

  @Field()
  email!: string;

  @Field(() => String, { nullable: true, description: '10-digit mobile number without +91.' })
  phone?: string | null;

  @Field({
    description:
      'True when the email belongs to an account the calling reseller did not create: only the email it typed is returned, never that account’s name or phone.',
  })
  detailsWithheld!: boolean;
}

@ObjectType()
export class InstituteModel {
  @Field(() => [String], {
    description: 'Languages enabled for institute-authored text. English is always included.',
  })
  supportedLocales!: string[];

  @Field({ description: 'Fallback language for institute-authored text; must be enabled.' })
  defaultLocale!: string;

  @Field(() => ID)
  id!: string;

  @Field(() => I18nTextScalar)
  name!: Record<string, string>;

  @Field(() => String)
  slug!: string;

  @Field(() => String, { nullable: true })
  code?: string | null;

  @Field(() => InstituteType)
  type!: InstituteType;

  @Field(() => StructureFramework)
  structureFramework!: StructureFramework;

  @Field(() => SetupStatus)
  setupStatus!: SetupStatus;

  @Field(() => InstituteContactObject)
  contact!: DbInstituteContact;

  @Field(() => InstituteAddressObject, { nullable: true })
  address?: DbInstituteAddress | null;

  @Field(() => String)
  timezone!: string;

  @Field(() => String)
  currency!: string;

  @Field(() => GraphQLJSON)
  settings!: Record<string, unknown>;

  @Field(() => InstituteStatus)
  status!: InstituteStatus;

  @Field(() => Int)
  version!: number;

  @Field(() => DateTimeScalar)
  createdAt!: Date;

  @Field(() => DateTimeScalar)
  updatedAt!: Date;

  /**
   * Reseller assignment — every institute is owned by exactly one reseller (defaults to the
   * platform-managed "Roviq Direct" reseller). Nullable only in the GraphQL schema so cached
   * institute payloads without the join still serialize.
   */
  @Field(() => String, { nullable: true })
  resellerId?: string | null;

  /** Optional institute-group (franchise/trust) assignment. */
  @Field(() => String, { nullable: true })
  groupId?: string | null;

  /** Education levels offered by this institute — empty for non-school types. */
  @Field(() => [String], { nullable: true })
  departments?: string[] | null;

  /** True if this institute was created as a demo (sample data, notifications disabled). */
  @Field(() => Boolean, { nullable: true })
  isDemo?: boolean | null;

  /** Not a schema field: `InstituteFirstAdminFieldResolver` resolves `firstAdmin` from it. */
  firstAdminUserId?: string | null;
}
