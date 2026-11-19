import { Field, ID, Int, ObjectType } from '@nestjs/graphql';
import { IndianState, ResellerStatus, ResellerTier } from '@roviq/common-types';
import { DateTimeScalar } from '@roviq/nestjs-graphql';
import { ResellerBrandingModel } from '../../../admin/reseller/models/admin-reseller.model';
import {
  InstituteAddressObject,
  InstituteContactObject,
} from '../../../institute/management/models/institute.model';

@ObjectType({ description: "The signed-in reseller's own record, as its staff see it" })
export class ResellerProfileModel {
  @Field(() => ID)
  id!: string;

  @Field(() => String)
  name!: string;

  @Field(() => String, { description: 'URL-safe identifier. Fixed at creation.' })
  slug!: string;

  @Field(() => ResellerTier, { description: 'Set by the platform; a reseller cannot change it' })
  tier!: ResellerTier;

  @Field(() => ResellerStatus)
  status!: ResellerStatus;

  @Field(() => Boolean, {
    description: 'True for the built-in "Roviq Direct" reseller, whose name cannot be changed',
  })
  isSystem!: boolean;

  @Field(() => ResellerBrandingModel, { nullable: true })
  branding?: ResellerBrandingModel | null;

  @Field(() => String, {
    nullable: true,
    description: 'Custom domain, set by the platform. Not yet served (auth PRD §23.4).',
  })
  customDomain?: string | null;

  @Field(() => String, {
    nullable: true,
    description: 'Company / business registration number (e.g. CIN or GSTIN)',
  })
  registrationNumber?: string | null;

  @Field(() => IndianState, { nullable: true, description: 'State the business is registered in' })
  registrationState?: IndianState | null;

  @Field(() => InstituteContactObject, { description: 'Business contact phones and emails' })
  contact!: Record<string, unknown>;

  @Field(() => InstituteAddressObject, { nullable: true, description: 'Registered address' })
  address?: Record<string, unknown> | null;

  @Field(() => Int, {
    description:
      'Optimistic concurrency version — pass it back to resellerUpdateProfile and resellerUpdateBranding',
  })
  version!: number;

  @Field(() => DateTimeScalar)
  createdAt!: Date;

  @Field(() => DateTimeScalar)
  updatedAt!: Date;
}
