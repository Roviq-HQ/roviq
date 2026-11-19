/**
 * GraphQL models for the admin reseller management surface (ROV-234).
 *
 * Mirrors the `resellers` Drizzle table (libs/database/src/schema/reseller/resellers.ts)
 * and registers the two reseller enums with NestJS GraphQL so the SDL surfaces
 * them as first-class types — keeping the frontend TypeScript enums in lockstep
 * via codegen.
 */
import { Field, ID, Int, ObjectType, registerEnumType } from '@nestjs/graphql';
import {
  IndianState,
  ResellerBrandingTheme,
  ResellerStatus,
  ResellerTier,
} from '@roviq/common-types';
import type { I18nContent } from '@roviq/database';
import { DateTimeScalar, I18nTextScalar } from '@roviq/nestjs-graphql';
import { createConnectionType } from '../../../common/pagination/relay-pagination.model';
import {
  InstituteAddressObject,
  InstituteContactObject,
} from '../../../institute/management/models/institute.model';

registerEnumType(ResellerTier, {
  name: 'ResellerTier',
  description: 'Tier controlling what a reseller can do with its assigned institutes',
});

registerEnumType(ResellerStatus, {
  name: 'ResellerStatus',
  description: 'Lifecycle state of a reseller account',
});

registerEnumType(ResellerBrandingTheme, {
  name: 'ResellerBrandingTheme',
  description: 'Colour scheme of the reseller white-label portal',
});

/**
 * Structured branding descriptor stored in the `resellers.branding` JSONB column.
 * All fields optional — defaults are applied by the reseller-admin portal when
 * absent. Logo and favicon are files (`logo`, `favicon` on the reseller), not part of this JSON.
 */
@ObjectType({ description: 'Reseller branding configuration (colours, colour scheme, stylesheet)' })
export class ResellerBrandingModel {
  @Field(() => String, {
    nullable: true,
    description: 'Primary brand colour as a hex code (e.g. "#1677FF")',
  })
  primaryColor?: string | null;

  @Field(() => String, {
    nullable: true,
    description: 'Secondary/accent brand colour as a hex code',
  })
  secondaryColor?: string | null;

  @Field(() => ResellerBrandingTheme, {
    nullable: true,
    description: "Colour scheme; absent means it follows the viewer's device",
  })
  theme?: ResellerBrandingTheme | null;

  @Field(() => String, {
    nullable: true,
    description: 'Extra stylesheet written by the reseller. Stored, not yet applied to any portal.',
  })
  customCss?: string | null;
}

@ObjectType({ description: 'Platform-admin view of a reseller account' })
export class AdminResellerModel {
  @Field(() => ID)
  id!: string;

  @Field(() => String)
  name!: string;

  @Field(() => String, {
    description:
      'URL-safe slug, globally unique. Immutable after creation (changing it breaks URLs).',
  })
  slug!: string;

  @Field(() => ResellerTier)
  tier!: ResellerTier;

  @Field(() => ResellerStatus)
  status!: ResellerStatus;

  @Field(() => Boolean, {
    description:
      'True for the built-in "Roviq Direct" reseller — cannot be suspended, deleted, or have its tier changed',
  })
  isSystem!: boolean;

  @Field(() => Boolean)
  isActive!: boolean;

  @Field(() => ResellerBrandingModel, { nullable: true })
  branding?: ResellerBrandingModel | null;

  @Field(() => String, {
    nullable: true,
    description: 'Custom vanity domain (deferred — placeholder for PRD §23.4)',
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
    description: 'Optimistic concurrency version — pass it back to adminUpdateReseller',
  })
  version!: number;

  @Field(() => DateTimeScalar, {
    nullable: true,
    description: 'Timestamp of most recent suspension; null when active',
  })
  suspendedAt?: Date | null;

  @Field(() => DateTimeScalar, {
    nullable: true,
    description: 'Soft-delete timestamp; set when status=DELETED',
  })
  deletedAt?: Date | null;

  @Field(() => DateTimeScalar)
  createdAt!: Date;

  @Field(() => DateTimeScalar)
  updatedAt!: Date;

  @Field(() => Int, {
    description: 'Number of non-deleted institutes currently assigned to this reseller',
  })
  instituteCount!: number;

  @Field(() => Int, {
    description: 'Number of active reseller_memberships (staff accounts) for this reseller',
  })
  teamSize!: number;
}

@ObjectType({ description: 'A staff member of a reseller, as seen by a platform admin' })
export class AdminResellerTeamMemberModel {
  @Field(() => ID, { description: 'reseller_memberships.id' })
  id!: string;

  @Field(() => ID)
  userId!: string;

  @Field(() => String, { description: 'Roviq ID' })
  username!: string;

  @Field(() => String)
  email!: string;

  @Field(() => I18nTextScalar, { nullable: true })
  firstName?: I18nContent | null;

  @Field(() => I18nTextScalar, { nullable: true })
  lastName?: I18nContent | null;

  @Field(() => I18nTextScalar, { nullable: true })
  roleName?: I18nContent | null;

  @Field(() => Boolean)
  isActive!: boolean;

  @Field(() => DateTimeScalar)
  joinedAt!: Date;

  @Field(() => DateTimeScalar, {
    nullable: true,
    description: 'Latest login, token refresh or institute switch; null if never signed in',
  })
  lastActiveAt?: Date | null;
}

export const { ConnectionType: AdminResellerConnection, EdgeType: AdminResellerEdge } =
  createConnectionType(AdminResellerModel, 'AdminReseller');
