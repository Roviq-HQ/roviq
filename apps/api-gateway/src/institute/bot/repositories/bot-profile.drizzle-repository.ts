import { Inject, Injectable } from '@nestjs/common';
import {
  BotRateLimitTier,
  BotStatus,
  BotType,
  BusinessException,
  ErrorCode,
} from '@roviq/common-types';
import {
  botProfiles,
  botProfilesLive,
  DRIZZLE_DB,
  type DrizzleDB,
  memberships,
  mkAdminCtx,
  mkInstituteCtx,
  roles,
  rolesLive,
  users,
  withAdmin,
  withTenant,
} from '@roviq/database';
import { getRequestContext } from '@roviq/request-context';
import { and, eq, isNull } from 'drizzle-orm';
import { insertOrRestoreMembership } from '../../../auth/membership-lifecycle';
import { BotProfileRepository } from './bot-profile.repository';
import type {
  BotProfileRecord,
  CreateBotMembershipData,
  CreateBotProfileData,
  CreateBotUserData,
  InstituteRoleRecord,
  UpdateBotProfileData,
} from './types';

const liveColumns = {
  id: botProfilesLive.id,
  userId: botProfilesLive.userId,
  membershipId: botProfilesLive.membershipId,
  tenantId: botProfilesLive.tenantId,
  botType: botProfilesLive.botType,
  apiKeyPrefix: botProfilesLive.apiKeyPrefix,
  status: botProfilesLive.status,
  rateLimitTier: botProfilesLive.rateLimitTier,
  webhookUrl: botProfilesLive.webhookUrl,
  isSystemBot: botProfilesLive.isSystemBot,
  config: botProfilesLive.config,
  lastActiveAt: botProfilesLive.lastActiveAt,
  createdAt: botProfilesLive.createdAt,
  updatedAt: botProfilesLive.updatedAt,
} as const;

const returningColumns = {
  id: botProfiles.id,
  userId: botProfiles.userId,
  membershipId: botProfiles.membershipId,
  tenantId: botProfiles.tenantId,
  botType: botProfiles.botType,
  apiKeyPrefix: botProfiles.apiKeyPrefix,
  status: botProfiles.status,
  rateLimitTier: botProfiles.rateLimitTier,
  webhookUrl: botProfiles.webhookUrl,
  isSystemBot: botProfiles.isSystemBot,
  config: botProfiles.config,
  lastActiveAt: botProfiles.lastActiveAt,
  createdAt: botProfiles.createdAt,
  updatedAt: botProfiles.updatedAt,
} as const;

@Injectable()
export class BotProfileDrizzleRepository extends BotProfileRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDB) {
    super();
  }

  private getTenantId(): string {
    const { tenantId } = getRequestContext();
    if (!tenantId) throw new Error('Tenant context is required');
    return tenantId;
  }

  async findById(id: string): Promise<BotProfileRecord | null> {
    const tenantId = this.getTenantId();
    return withTenant(this.db, mkInstituteCtx(tenantId, 'repository:bot-profile'), async (tx) => {
      const rows = await tx
        .select(liveColumns)
        .from(botProfilesLive)
        .where(eq(botProfilesLive.id, id));
      return (rows[0] as BotProfileRecord | undefined) ?? null;
    });
  }

  async findAll(filters?: { botType?: BotType; status?: BotStatus }): Promise<BotProfileRecord[]> {
    const tenantId = this.getTenantId();
    return withTenant(this.db, mkInstituteCtx(tenantId, 'repository:bot-profile'), async (tx) => {
      const conditions = [];
      if (filters?.botType) {
        conditions.push(eq(botProfilesLive.botType, filters.botType));
      }
      if (filters?.status) {
        conditions.push(eq(botProfilesLive.status, filters.status));
      }

      return tx
        .select(liveColumns)
        .from(botProfilesLive)
        .where(conditions.length > 0 ? and(...conditions) : undefined);
    });
  }

  async create(data: CreateBotProfileData): Promise<BotProfileRecord> {
    const tenantId = this.getTenantId();
    return withTenant(this.db, mkInstituteCtx(tenantId, 'repository:bot-profile'), async (tx) => {
      const rows = await tx
        .insert(botProfiles)
        .values({
          userId: data.userId,
          membershipId: data.membershipId,
          tenantId: data.tenantId,
          botType: data.botType,
          apiKeyHash: data.apiKeyHash,
          apiKeyPrefix: data.apiKeyPrefix,
          webhookUrl: data.webhookUrl,
          config: data.config ?? {},
          rateLimitTier: data.rateLimitTier ?? BotRateLimitTier.LOW,
          status: BotStatus.ACTIVE,
          isSystemBot: false,
          createdBy: data.createdBy,
          updatedBy: data.createdBy,
        })
        .returning(returningColumns);
      return rows[0] as BotProfileRecord;
    });
  }

  async update(id: string, data: UpdateBotProfileData): Promise<BotProfileRecord> {
    const tenantId = this.getTenantId();
    const { userId } = getRequestContext();
    return withTenant(this.db, mkInstituteCtx(tenantId, 'repository:bot-profile'), async (tx) => {
      const rows = await tx
        .update(botProfiles)
        .set({
          ...(data.config !== undefined && { config: data.config }),
          ...(data.webhookUrl !== undefined && { webhookUrl: data.webhookUrl }),
          ...(data.rateLimitTier !== undefined && { rateLimitTier: data.rateLimitTier }),
          ...(data.status !== undefined && { status: data.status }),
          ...(data.apiKeyHash !== undefined && { apiKeyHash: data.apiKeyHash }),
          ...(data.apiKeyPrefix !== undefined && { apiKeyPrefix: data.apiKeyPrefix }),
          updatedBy: userId,
        })
        .where(and(eq(botProfiles.id, id), isNull(botProfiles.deletedAt)))
        .returning(returningColumns);

      if (rows.length === 0)
        throw new BusinessException(ErrorCode.BOT_NOT_FOUND, `Bot profile ${id} not found`);
      return rows[0] as BotProfileRecord;
    });
  }

  async softDelete(id: string): Promise<void> {
    const tenantId = this.getTenantId();
    const { userId } = getRequestContext();
    await withTenant(this.db, mkInstituteCtx(tenantId, 'repository:bot-profile'), async (tx) => {
      const rows = await tx
        .update(botProfiles)
        .set({ deletedAt: new Date(), deletedBy: userId, updatedBy: userId })
        .where(and(eq(botProfiles.id, id), isNull(botProfiles.deletedAt)))
        .returning({ id: botProfiles.id });
      if (rows.length === 0)
        throw new BusinessException(ErrorCode.BOT_NOT_FOUND, `Bot profile ${id} not found`);
    });
  }

  async createBotUser(data: CreateBotUserData): Promise<{ id: string }> {
    return withAdmin(this.db, mkAdminCtx('service:bot'), async (tx) => {
      const [created] = await tx
        .insert(users)
        .values({
          createdBy: data.createdBy,
          updatedBy: data.createdBy,
          username: data.username,
          email: data.email,
          passwordHash: data.passwordHash,
          originTenantId: data.tenantId,
        })
        .returning({ id: users.id });
      return created;
    });
  }

  async findInstituteRoles(tenantId: string): Promise<InstituteRoleRecord[]> {
    return withAdmin(this.db, mkAdminCtx('service:bot'), async (tx) => {
      return tx
        .select({ id: rolesLive.id, name: rolesLive.name })
        .from(rolesLive)
        .where(and(eq(rolesLive.tenantId, tenantId), eq(rolesLive.scope, 'institute')));
    });
  }

  async createBotRole(tenantId: string, createdBy: string): Promise<{ id: string }> {
    const [newRole] = await withAdmin(this.db, mkAdminCtx('service:bot'), async (tx) => {
      return tx
        .insert(roles)
        .values({
          tenantId,
          scope: 'institute',
          name: { en: 'Bot' },
          abilities: [],
          isDefault: false,
          isSystem: true,
          status: 'ACTIVE',
          createdBy,
          updatedBy: createdBy,
        })
        .returning({ id: roles.id });
    });
    return newRole;
  }

  async createBotMembership(data: CreateBotMembershipData): Promise<{ id: string }> {
    return withTenant(this.db, mkInstituteCtx(data.tenantId, 'service:bot'), async (tx) => {
      const id = await insertOrRestoreMembership(tx, {
        userId: data.userId,
        roleId: data.roleId,
        tenantId: data.tenantId,
        abilities: [],
        actorId: data.createdBy,
      });
      return { id };
    });
  }

  // Admin role: the bot profile is already soft-deleted, so the membership is no longer
  // reachable under tenant RLS through it. The id comes from that profile, read under RLS.
  async revokeMembership(membershipId: string): Promise<void> {
    await withAdmin(this.db, mkAdminCtx('service:bot'), async (tx) => {
      await tx
        .update(memberships)
        .set({ status: 'REVOKED' })
        .where(eq(memberships.id, membershipId));
    });
  }
}
