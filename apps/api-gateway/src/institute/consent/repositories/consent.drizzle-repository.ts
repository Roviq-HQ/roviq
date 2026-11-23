import { Inject, Injectable } from '@nestjs/common';
import {
  consentRecords,
  DRIZZLE_DB,
  type DrizzleDB,
  guardianProfilesLive,
  mkInstituteCtx,
  studentGuardianLinksLive,
  withTenant,
} from '@roviq/database';
import { eq, sql } from 'drizzle-orm';
import { ConsentRepository } from './consent.repository';
import type {
  ConsentGrantData,
  ConsentRecordRow,
  ConsentWriteData,
  LatestConsentRow,
} from './types';

@Injectable()
export class ConsentDrizzleRepository extends ConsentRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDB) {
    super();
  }

  async findGuardianProfileId(tenantId: string, membershipId: string): Promise<string | null> {
    const rows = await withTenant(
      this.db,
      mkInstituteCtx(tenantId, 'service:consent'),
      async (tx) => {
        return tx
          .select({ id: guardianProfilesLive.id })
          .from(guardianProfilesLive)
          .where(eq(guardianProfilesLive.membershipId, membershipId))
          .limit(1);
      },
    );
    return rows[0]?.id ?? null;
  }

  async isGuardianLinkedToStudent(
    tenantId: string,
    guardianProfileId: string,
    studentProfileId: string,
  ): Promise<boolean> {
    const links = await withTenant(
      this.db,
      mkInstituteCtx(tenantId, 'service:consent'),
      async (tx) => {
        return tx
          .select({ id: studentGuardianLinksLive.id })
          .from(studentGuardianLinksLive)
          .where(
            sql`${studentGuardianLinksLive.guardianProfileId} = ${guardianProfileId}
            AND ${studentGuardianLinksLive.studentProfileId} = ${studentProfileId}`,
          )
          .limit(1);
      },
    );
    return links.length > 0;
  }

  async insertGrant(data: ConsentGrantData): Promise<ConsentRecordRow> {
    const rows = await withTenant(
      this.db,
      mkInstituteCtx(data.tenantId, 'service:consent'),
      async (tx) => {
        return tx
          .insert(consentRecords)
          .values({
            tenantId: data.tenantId,
            guardianProfileId: data.guardianProfileId,
            studentProfileId: data.studentProfileId,
            purpose: data.purpose,
            isGranted: true,
            grantedAt: new Date(),
            verificationMethod: data.verificationMethod,
            ipAddress: data.ipAddress,
            userAgent: data.userAgent,
          })
          .returning();
      },
    );
    return rows[0];
  }

  async insertWithdrawal(data: ConsentWriteData): Promise<ConsentRecordRow> {
    const rows = await withTenant(
      this.db,
      mkInstituteCtx(data.tenantId, 'service:consent'),
      async (tx) => {
        return tx
          .insert(consentRecords)
          .values({
            tenantId: data.tenantId,
            guardianProfileId: data.guardianProfileId,
            studentProfileId: data.studentProfileId,
            purpose: data.purpose,
            isGranted: false,
            withdrawnAt: new Date(),
            ipAddress: data.ipAddress,
            userAgent: data.userAgent,
          })
          .returning();
      },
    );
    return rows[0];
  }

  async latestForStudent(tenantId: string, studentProfileId: string): Promise<LatestConsentRow[]> {
    const record = await withTenant(
      this.db,
      mkInstituteCtx(tenantId, 'service:consent'),
      async (tx) => {
        return tx.execute<LatestConsentRow>(
          sql`SELECT DISTINCT ON (purpose)
            student_profile_id,
            purpose,
            is_granted,
            created_at
          FROM consent_records
          WHERE student_profile_id = ${studentProfileId}
          ORDER BY purpose, created_at DESC`,
        );
      },
    );
    return record.rows;
  }

  async latestForGuardian(
    tenantId: string,
    guardianProfileId: string,
  ): Promise<LatestConsentRow[]> {
    const record = await withTenant(
      this.db,
      mkInstituteCtx(tenantId, 'service:consent'),
      async (tx) => {
        return tx.execute<LatestConsentRow>(
          sql`SELECT DISTINCT ON (student_profile_id, purpose)
            student_profile_id,
            purpose,
            is_granted,
            created_at
          FROM consent_records
          WHERE guardian_profile_id = ${guardianProfileId}
          ORDER BY student_profile_id, purpose, created_at DESC`,
        );
      },
    );
    return record.rows;
  }
}
