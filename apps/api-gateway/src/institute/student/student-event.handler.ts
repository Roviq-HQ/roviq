import { Controller, Inject, Logger } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import { AcademicStatus, PromotionStatus } from '@roviq/common-types';
import {
  DRIZZLE_DB,
  type DrizzleDB,
  mkInstituteCtx,
  SYSTEM_USER_ID,
  sectionsLive,
  studentAcademics,
  withTenant,
} from '@roviq/database';
import { EVENT_PATTERNS, eventPayloadSchemas } from '@roviq/nats-jetstream';
import { and, eq, isNull, notExists, sql } from 'drizzle-orm';
import { gatewayConsumer } from '../../common/events/gateway-consumer';

const ORIGIN = 'consumer:student-event.handler';

const CONTINUING_STATUSES = [
  AcademicStatus.ENROLLED,
  AcademicStatus.PROMOTED,
  AcademicStatus.DETAINED,
  AcademicStatus.RE_ENROLLED,
] as const;

interface RolloverCounts extends Record<string, unknown> {
  continuing: number;
  placed: number;
  created: number;
}

/** JetStream consumers for events that change students' year records. Safe to redeliver. */
@Controller()
export class StudentEventHandler {
  private readonly logger = new Logger(StudentEventHandler.name);

  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDB) {}

  /**
   * Gives each continuing student of the previous year a row in the new year. Standards belong
   * to one year, so the target standard (the promoted one when set, else the same) is matched
   * in the new year by `numeric_order`; the student goes into that standard's first section.
   */
  @EventPattern(
    EVENT_PATTERNS.ACADEMIC_YEAR.activated,
    gatewayConsumer(EVENT_PATTERNS.ACADEMIC_YEAR.activated),
  )
  async onAcademicYearActivated(@Payload() data: unknown): Promise<void> {
    const { tenantId, academicYearId, previousYearId } =
      eventPayloadSchemas[EVENT_PATTERNS.ACADEMIC_YEAR.activated].parse(data);
    if (!previousYearId) {
      this.logger.log(`Year ${academicYearId} has no previous year; no student rollover`);
      return;
    }

    const counts = await withTenant(this.db, mkInstituteCtx(tenantId, ORIGIN), async (tx) => {
      const statuses = sql.join(
        CONTINUING_STATUSES.map((s) => sql`${s}`),
        sql`, `,
      );
      const result = await tx.execute<RolloverCounts>(sql`
        WITH continuing AS (
          SELECT sa.student_profile_id,
                 CASE
                   WHEN sa.promotion_status = ${PromotionStatus.PROMOTED}
                        AND sa.promoted_to_standard_id IS NOT NULL
                     THEN sa.promoted_to_standard_id
                   ELSE sa.standard_id
                 END AS target_standard_id
          FROM student_academics_live sa
          JOIN student_profiles_live sp ON sp.id = sa.student_profile_id
          WHERE sa.academic_year_id = ${previousYearId}::uuid
            AND sp.academic_status IN (${statuses})
            AND EXISTS (SELECT 1 FROM academic_years_live ay WHERE ay.id = ${academicYearId}::uuid)
            -- A deleted row counts too: redelivery must not re-place a student removed since.
            AND NOT EXISTS (
              SELECT 1 FROM student_academics done
              WHERE done.student_profile_id = sa.student_profile_id
                AND done.academic_year_id = ${academicYearId}::uuid
            )
        ),
        placed AS (
          SELECT c.student_profile_id, ns.id AS standard_id, sec.id AS section_id
          FROM continuing c
          JOIN standards_live ts ON ts.id = c.target_standard_id
          JOIN standards_live ns
            ON ns.academic_year_id = ${academicYearId}::uuid AND ns.numeric_order = ts.numeric_order
          JOIN LATERAL (
            SELECT s.id FROM sections_live s
            WHERE s.standard_id = ns.id AND s.academic_year_id = ${academicYearId}::uuid
            ORDER BY s.display_order, s.id
            LIMIT 1
          ) sec ON true
        ),
        inserted AS (
          INSERT INTO student_academics
            (tenant_id, student_profile_id, academic_year_id, standard_id, section_id,
             created_by, updated_by)
          SELECT ${tenantId}::uuid, p.student_profile_id, ${academicYearId}::uuid, p.standard_id,
                 p.section_id, ${SYSTEM_USER_ID}::uuid, ${SYSTEM_USER_ID}::uuid
          FROM placed p
          ON CONFLICT (student_profile_id, academic_year_id) WHERE deleted_at IS NULL DO NOTHING
          RETURNING 1
        )
        SELECT (SELECT count(*) FROM continuing)::int AS continuing,
               (SELECT count(*) FROM placed)::int AS placed,
               (SELECT count(*) FROM inserted)::int AS created
      `);
      return result.rows[0];
    });

    this.logger.log(
      `Student rollover ${previousYearId} -> ${academicYearId}: ${counts.created} rows created, ` +
        `${counts.continuing - counts.placed} students skipped (no section in the new year)`,
    );
  }

  /**
   * `section_id` is NOT NULL, so the section's student rows are soft-deleted for reassignment.
   * Only while the section is still deleted: a stale event must not empty a live section.
   */
  @EventPattern(EVENT_PATTERNS.SECTION.deleted, gatewayConsumer(EVENT_PATTERNS.SECTION.deleted))
  async onSectionDeleted(@Payload() data: unknown): Promise<void> {
    const { sectionId, tenantId } = eventPayloadSchemas[EVENT_PATTERNS.SECTION.deleted].parse(data);

    const affected = await withTenant(this.db, mkInstituteCtx(tenantId, ORIGIN), (tx) => {
      const now = new Date();
      return tx
        .update(studentAcademics)
        .set({
          deletedAt: now,
          deletedBy: SYSTEM_USER_ID,
          updatedAt: now,
          updatedBy: SYSTEM_USER_ID,
        })
        .where(
          and(
            eq(studentAcademics.sectionId, sectionId),
            isNull(studentAcademics.deletedAt),
            notExists(
              tx
                .select({ id: sectionsLive.id })
                .from(sectionsLive)
                .where(eq(sectionsLive.id, sectionId)),
            ),
          ),
        )
        .returning({ id: studentAcademics.id });
    });

    this.logger.log(
      `Section ${sectionId} deleted: soft-deleted ${affected.length} student_academics rows`,
    );
  }
}
