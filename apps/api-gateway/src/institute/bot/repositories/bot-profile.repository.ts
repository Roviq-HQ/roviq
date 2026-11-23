import type {
  BotProfileRecord,
  CreateBotMembershipData,
  CreateBotProfileData,
  CreateBotUserData,
  InstituteRoleRecord,
  UpdateBotProfileData,
} from './types';

export abstract class BotProfileRepository {
  abstract findById(id: string): Promise<BotProfileRecord | null>;
  abstract findAll(filters?: { botType?: string; status?: string }): Promise<BotProfileRecord[]>;
  abstract create(data: CreateBotProfileData): Promise<BotProfileRecord>;
  abstract update(id: string, data: UpdateBotProfileData): Promise<BotProfileRecord>;
  abstract softDelete(id: string): Promise<void>;
  /** Creates the bot's platform-level user account. */
  abstract createBotUser(data: CreateBotUserData): Promise<{ id: string }>;
  /** Every institute-scope role of the tenant. */
  abstract findInstituteRoles(tenantId: string): Promise<InstituteRoleRecord[]>;
  /** Creates the tenant's system 'Bot' role. */
  abstract createBotRole(tenantId: string, createdBy: string): Promise<{ id: string }>;
  abstract createBotMembership(data: CreateBotMembershipData): Promise<{ id: string }>;
  abstract revokeMembership(membershipId: string): Promise<void>;
}
