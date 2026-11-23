import { Inject, Injectable } from '@nestjs/common';
import { seedDefaultRoles } from '@roviq/casl';
import {
  academicYears,
  academicYearsLive,
  DRIZZLE_DB,
  type DrizzleDB,
  instituteConfigs,
  instituteNotificationConfigs,
  institutes,
  institutesLive,
  mkAdminCtx,
  rolesLive,
  withAdmin,
} from '@roviq/database';
import { and, eq, sql } from 'drizzle-orm';
import { InstituteSetupRepository } from './institute-setup.repository';
import type { FirstAcademicYearData, SectionStrengthNorms, SetupStatus } from './types';

@Injectable()
export class InstituteSetupDrizzleRepository extends InstituteSetupRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDB) {
    super();
  }

  async createDefaultRoles(instituteId: string): Promise<void> {
    await seedDefaultRoles(this.db, instituteId);
  }

  async findFirstAdminUserId(instituteId: string): Promise<string | null> {
    const [institute] = await withAdmin(
      this.db,
      mkAdminCtx('seeder:institute-setup.service'),
      (tx) =>
        tx
          .select({ firstAdminUserId: institutesLive.firstAdminUserId })
          .from(institutesLive)
          .where(eq(institutesLive.id, instituteId)),
    );
    return institute?.firstAdminUserId ?? null;
  }

  async findRoleIdByName(instituteId: string, name: string): Promise<string | null> {
    const [role] = await withAdmin(this.db, mkAdminCtx('seeder:institute-setup.service'), (tx) =>
      tx
        .select({ id: rolesLive.id })
        .from(rolesLive)
        .where(and(eq(rolesLive.tenantId, instituteId), sql`${rolesLive.name}->>'en' = ${name}`))
        .limit(1),
    );
    return role?.id ?? null;
  }

  async createNotificationConfigs(
    instituteId: string,
    notificationTypes: readonly string[],
    actorId: string,
  ): Promise<void> {
    await withAdmin(this.db, mkAdminCtx('seeder:institute-setup.service'), async (tx) => {
      for (const notificationType of notificationTypes) {
        await tx
          .insert(instituteNotificationConfigs)
          .values({
            tenantId: instituteId,
            notificationType,
            inAppEnabled: true,
            whatsappEnabled: false,
            emailEnabled: true,
            pushEnabled: false,
            digestEnabled: false,
            createdBy: actorId,
            updatedBy: actorId,
          })
          .onConflictDoNothing();
      }
    });
  }

  async createInstituteConfig(
    instituteId: string,
    sectionStrengthNorms: SectionStrengthNorms,
    actorId: string,
  ): Promise<void> {
    await withAdmin(this.db, mkAdminCtx('seeder:institute-setup.service'), async (tx) => {
      await tx
        .insert(instituteConfigs)
        .values({
          tenantId: instituteId,
          sectionStrengthNorms,
          createdBy: actorId,
          updatedBy: actorId,
        })
        .onConflictDoNothing();
    });
  }

  async findOrCreateFirstAcademicYear(
    instituteId: string,
    year: FirstAcademicYearData,
    actorId: string,
  ): Promise<string> {
    return withAdmin(this.db, mkAdminCtx('seeder:institute-setup.service'), async (tx) => {
      const existing = await tx
        .select({ id: academicYearsLive.id })
        .from(academicYearsLive)
        .where(eq(academicYearsLive.tenantId, instituteId));
      if (existing.length > 0) return existing[0].id;

      const rows = await tx
        .insert(academicYears)
        .values({
          tenantId: instituteId,
          label: year.label,
          startDate: year.startDate,
          endDate: year.endDate,
          isActive: true,
          status: 'ACTIVE',
          createdBy: actorId,
          updatedBy: actorId,
        })
        .returning({ id: academicYears.id });
      return rows[0].id;
    });
  }

  async updateSetupStatus(
    instituteId: string,
    status: SetupStatus,
    actorId: string,
  ): Promise<void> {
    await withAdmin(this.db, mkAdminCtx('seeder:institute-setup.service'), async (tx) => {
      await tx
        .update(institutes)
        .set({ setupStatus: status, updatedBy: actorId })
        .where(eq(institutes.id, instituteId));
    });
  }
}
