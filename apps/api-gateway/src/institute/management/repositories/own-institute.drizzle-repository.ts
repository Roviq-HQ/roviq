import { Inject, Injectable } from '@nestjs/common';
import type { InstituteLocaleSettings } from '@roviq/common-types';
import {
  DRIZZLE_DB,
  type DrizzleDB,
  instituteBranding,
  instituteBrandingLive,
  instituteConfigs,
  institutes,
  institutesLive,
  mkInstituteCtx,
  withTenant,
} from '@roviq/database';
import { getRequestContext } from '@roviq/request-context';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { markFilesDeleted, markFilesReady } from '../../../files/file-attachment';
import { BRANDING_IMAGES, type BrandingImageColumn } from '../branding-images';
import { instituteColumns, instituteLiveColumns } from './institute-columns';
import { OwnInstituteRepository } from './own-institute.repository';
import type {
  InstituteRecord,
  UpdateInstituteBrandingData,
  UpdateInstituteConfigData,
  UpdateInstituteInfoData,
} from './types';

async function readOwn(tx: DrizzleDB, tenantId: string): Promise<InstituteRecord | null> {
  const rows = await tx
    .select(instituteLiveColumns)
    .from(institutesLive)
    .where(eq(institutesLive.id, tenantId));
  return (rows[0] as InstituteRecord | undefined) ?? null;
}

@Injectable()
export class OwnInstituteDrizzleRepository extends OwnInstituteRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDB) {
    super();
  }

  private tenantId(): string {
    const { tenantId } = getRequestContext();
    if (!tenantId) throw new Error('Tenant context is required');
    return tenantId;
  }

  private run<T>(fn: (tx: DrizzleDB, tenantId: string, userId: string) => Promise<T>): Promise<T> {
    const tenantId = this.tenantId();
    const { userId } = getRequestContext();
    return withTenant(this.db, mkInstituteCtx(tenantId, 'repository:own-institute'), (tx) =>
      fn(tx, tenantId, userId),
    );
  }

  find(): Promise<InstituteRecord | null> {
    return this.run((tx, tenantId) => readOwn(tx, tenantId));
  }

  updateInfo(data: UpdateInstituteInfoData): Promise<InstituteRecord | null> {
    return this.run(async (tx, tenantId, userId) => {
      const rows = await tx
        .update(institutes)
        .set({
          ...(data.name !== undefined && { name: data.name }),
          ...(data.code !== undefined && { code: data.code }),
          ...(data.contact !== undefined && { contact: data.contact }),
          ...(data.address !== undefined && { address: data.address }),
          ...(data.timezone !== undefined && { timezone: data.timezone }),
          ...(data.currency !== undefined && { currency: data.currency }),
          version: sql`${institutes.version} + 1`,
          updatedBy: userId,
        })
        .where(
          and(
            eq(institutes.id, tenantId),
            eq(institutes.version, data.version),
            isNull(institutes.deletedAt),
          ),
        )
        .returning(instituteColumns);
      return (rows[0] as InstituteRecord | undefined) ?? null;
    });
  }

  updateLocales(
    settings: InstituteLocaleSettings,
    version: number,
  ): Promise<InstituteRecord | null> {
    return this.run(async (tx, tenantId, userId) => {
      const rows = await tx
        .update(institutes)
        .set({ ...settings, version: sql`${institutes.version} + 1`, updatedBy: userId })
        .where(
          and(
            eq(institutes.id, tenantId),
            eq(institutes.version, version),
            isNull(institutes.deletedAt),
          ),
        )
        .returning(instituteColumns);
      return (rows[0] as InstituteRecord | undefined) ?? null;
    });
  }

  updateBranding(data: UpdateInstituteBrandingData): Promise<InstituteRecord | null> {
    return this.run(async (tx, tenantId, userId) => {
      const [current] = await tx
        .select({
          logoFileId: instituteBrandingLive.logoFileId,
          faviconFileId: instituteBrandingLive.faviconFileId,
          coverImageFileId: instituteBrandingLive.coverImageFileId,
        })
        .from(instituteBrandingLive)
        .where(eq(instituteBrandingLive.tenantId, tenantId));

      const images: Partial<Record<BrandingImageColumn, string | null>> = {};
      const replaced: string[] = [];
      for (const { column, purpose } of BRANDING_IMAGES) {
        const next = data[column];
        const previous = current?.[column] ?? null;
        if (next === undefined || next === previous) continue;
        images[column] = next;
        if (next) await markFilesReady(tx, { fileIds: [next], purpose, userId, tenantId });
        if (previous) replaced.push(previous);
      }

      const fields = {
        ...images,
        ...(data.primaryColor !== undefined && { primaryColor: data.primaryColor }),
        ...(data.secondaryColor !== undefined && { secondaryColor: data.secondaryColor }),
        ...(data.themeIdentifier !== undefined && { themeIdentifier: data.themeIdentifier }),
        updatedBy: userId,
      };
      await tx
        .insert(instituteBranding)
        .values({ tenantId, ...fields, createdBy: userId })
        .onConflictDoUpdate({
          target: instituteBranding.tenantId,
          // The unique index is partial; ON CONFLICT matches it only with the same predicate.
          targetWhere: sql`${instituteBranding.deletedAt} IS NULL`,
          set: fields,
        });
      await markFilesDeleted(tx, { fileIds: replaced, userId });
      return readOwn(tx, tenantId);
    });
  }

  updateConfig(data: UpdateInstituteConfigData): Promise<InstituteRecord | null> {
    return this.run(async (tx, tenantId, userId) => {
      const fields = {
        ...(data.attendanceType !== undefined && {
          attendanceType: data.attendanceType as 'LECTURE_WISE' | 'DAILY',
        }),
        ...(data.openingTime !== undefined && { openingTime: data.openingTime }),
        ...(data.closingTime !== undefined && { closingTime: data.closingTime }),
        ...(data.shifts !== undefined && { shifts: data.shifts }),
        ...(data.notificationPreferences !== undefined && {
          notificationPreferences: data.notificationPreferences,
        }),
        ...(data.payrollConfig !== undefined && { payrollConfig: data.payrollConfig }),
        ...(data.gradingSystem !== undefined && { gradingSystem: data.gradingSystem }),
        ...(data.termStructure !== undefined && { termStructure: data.termStructure }),
        ...(data.sectionStrengthNorms !== undefined && {
          sectionStrengthNorms: data.sectionStrengthNorms,
        }),
        updatedBy: userId,
      };
      await tx
        .insert(instituteConfigs)
        .values({ tenantId, ...fields, createdBy: userId })
        .onConflictDoUpdate({
          target: instituteConfigs.tenantId,
          // The unique index is partial; ON CONFLICT matches it only with the same predicate.
          targetWhere: sql`${instituteConfigs.deletedAt} IS NULL`,
          set: fields,
        });
      return readOwn(tx, tenantId);
    });
  }
}
