import { Controller, Inject, Logger } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import {
  DRIZZLE_DB,
  type DrizzleDB,
  mkInstituteCtx,
  SYSTEM_USER_ID,
  sectionsLive,
  studentAcademics,
  withTenant,
} from '@roviq/database';
import { EVENT_PATTERNS, eventPayloadSchemas, gatewayConsumer } from '@roviq/nats-jetstream';
import { and, eq, isNull, notExists } from 'drizzle-orm';
import { rollOverStudents } from './year-rollover';

const ORIGIN = 'consumer:student-event.handler';

/** JetStream consumers for events that change students' year records. Safe to redeliver. */
@Controller()
export class StudentEventHandler {
  private readonly logger = new Logger(StudentEventHandler.name);

  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDB) {}

  /** Places each continuing student of the previous year by the promotion rule in `year-rollover.ts`. */
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

    const { counts } = await withTenant(this.db, mkInstituteCtx(tenantId, ORIGIN), (tx) =>
      rollOverStudents(tx, { tenantId, previousYearId, academicYearId, write: true }),
    );

    this.logger.log(
      `Student rollover ${previousYearId} -> ${academicYearId}: ` +
        `movingUp=${counts.movingUp} staying=${counts.staying} completing=${counts.completing} ` +
        `notCarried=${counts.notCarried} noClassInNewYear=${counts.noClassInNewYear} ` +
        `alreadyPlaced=${counts.alreadyPlaced}`,
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
