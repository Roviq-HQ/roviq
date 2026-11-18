import { Field, ID, ObjectType } from '@nestjs/graphql';
import type { I18nContent } from '@roviq/database';
import { DateTimeScalar, I18nTextScalar } from '@roviq/nestjs-graphql';
import { createConnectionType } from '../../../common/pagination/relay-pagination.model';

@ObjectType({ description: 'Profile snapshot for a reseller team member' })
export class ResellerTeamMemberProfileModel {
  @Field(() => I18nTextScalar, { nullable: true })
  firstName?: I18nContent | null;

  @Field(() => I18nTextScalar, { nullable: true })
  lastName?: I18nContent | null;

  @Field(() => String, { nullable: true })
  profileImageUrl?: string | null;
}

@ObjectType({
  description:
    "A member of the reseller's own staff (a reseller-scope membership), not a user of a managed institute",
})
export class ResellerTeamMemberModel {
  @Field(() => ID, { description: 'reseller_memberships.id — the id every team mutation takes' })
  id!: string;

  @Field(() => ID)
  userId!: string;

  @Field()
  email!: string;

  @Field({ description: 'Roviq ID' })
  username!: string;

  @Field(() => ID)
  roleId!: string;

  @Field(() => I18nTextScalar, {
    nullable: true,
    description:
      'System role key in `en` (reseller_full_admin, reseller_support_admin, reseller_viewer)',
  })
  roleName?: I18nContent | null;

  @Field({ description: 'False when the membership has been deactivated' })
  isActive!: boolean;

  @Field(() => DateTimeScalar, { description: 'When the person joined this reseller' })
  joinedAt!: Date;

  @Field(() => DateTimeScalar, {
    nullable: true,
    description: 'Latest login, token refresh or institute switch; null if never signed in',
  })
  lastActiveAt?: Date | null;

  @Field({
    description:
      'Whether the caller may change this member: not themselves, and not someone holding a role senior to their own',
  })
  canManage!: boolean;

  @Field(() => ResellerTeamMemberProfileModel, { nullable: true })
  profile?: ResellerTeamMemberProfileModel | null;
}

@ObjectType({ description: 'One signed-in session (refresh token) of a team member' })
export class ResellerTeamSessionModel {
  @Field(() => ID)
  id!: string;

  @Field(() => String, { nullable: true })
  ipAddress?: string | null;

  @Field(() => String, { nullable: true })
  userAgent?: string | null;

  @Field(() => String, { nullable: true })
  deviceInfo?: string | null;

  @Field(() => DateTimeScalar, { description: 'When the session signed in or last renewed' })
  createdAt!: Date;

  @Field(() => DateTimeScalar, { nullable: true })
  lastUsedAt?: Date | null;

  @Field(() => DateTimeScalar)
  expiresAt!: Date;
}

@ObjectType({ description: 'A team member with their live sessions, for the detail sheet' })
export class ResellerTeamMemberDetailModel extends ResellerTeamMemberModel {
  @Field(() => [ResellerTeamSessionModel], {
    nullable: true,
    description:
      'Live sessions. Null unless the caller is this member or may manage them (see canManage).',
  })
  sessions?: ResellerTeamSessionModel[] | null;
}

@ObjectType({ description: 'A role the caller may give to a team member' })
export class ResellerTeamRoleModel {
  @Field(() => ID)
  id!: string;

  @Field(() => I18nTextScalar)
  name!: I18nContent;
}

export const { ConnectionType: ResellerTeamMemberConnection } = createConnectionType(
  ResellerTeamMemberModel,
  'ResellerTeamMember',
);
