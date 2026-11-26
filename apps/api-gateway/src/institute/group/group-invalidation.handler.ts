import { Controller, Inject, Logger } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import { GROUP_RULE_DIMENSION_VALUES, GroupMembershipType } from '@roviq/common-types';
import {
  DRIZZLE_DB,
  type DrizzleDB,
  groupRulesLive,
  groups,
  mkInstituteCtx,
  withTenant,
} from '@roviq/database';
import { EVENT_PATTERNS, eventPayloadSchemas, gatewayConsumer } from '@roviq/nats-jetstream';
import { and, arrayOverlaps, eq, inArray, isNull, type SQL } from 'drizzle-orm';

const ORIGIN = 'consumer:group-invalidation';
const RULE_DIMENSIONS: ReadonlySet<string> = new Set(GROUP_RULE_DIMENSION_VALUES);

/**
 * Sets `groups.resolved_at = NULL` on groups whose members an event may have changed; the next
 * read re-resolves them. Idempotent, so redelivery is harmless.
 */
@Controller()
export class GroupInvalidationHandler {
  private readonly logger = new Logger(GroupInvalidationHandler.name);

  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDB) {}

  @EventPattern(EVENT_PATTERNS.STUDENT.enrolled, gatewayConsumer(EVENT_PATTERNS.STUDENT.enrolled))
  async onStudentEnrolled(@Payload() data: unknown): Promise<void> {
    const { tenantId } = eventPayloadSchemas[EVENT_PATTERNS.STUDENT.enrolled].parse(data);
    await this.invalidateByDimensions(tenantId, ['standard_id', 'section_id']);
  }

  @EventPattern(
    EVENT_PATTERNS.STUDENT.section_changed,
    gatewayConsumer(EVENT_PATTERNS.STUDENT.section_changed),
  )
  async onStudentSectionChanged(@Payload() data: unknown): Promise<void> {
    const { tenantId } = eventPayloadSchemas[EVENT_PATTERNS.STUDENT.section_changed].parse(data);
    await this.invalidateByDimensions(tenantId, ['section_id']);
  }

  @EventPattern(EVENT_PATTERNS.STUDENT.promoted, gatewayConsumer(EVENT_PATTERNS.STUDENT.promoted))
  async onStudentPromoted(@Payload() data: unknown): Promise<void> {
    const { tenantId } = eventPayloadSchemas[EVENT_PATTERNS.STUDENT.promoted].parse(data);
    await this.invalidateByDimensions(tenantId, ['standard_id']);
  }

  @EventPattern(
    EVENT_PATTERNS.STUDENT.statusChanged,
    gatewayConsumer(EVENT_PATTERNS.STUDENT.statusChanged),
  )
  async onStudentStatusChanged(@Payload() data: unknown): Promise<void> {
    const { tenantId } = eventPayloadSchemas[EVENT_PATTERNS.STUDENT.statusChanged].parse(data);
    await this.invalidateByDimensions(tenantId, ['academic_status']);
  }

  /** Invalidates only the rule dimensions the update set: `isRteAdmitted` → `is_rte_admitted`. */
  @EventPattern(EVENT_PATTERNS.STUDENT.updated, gatewayConsumer(EVENT_PATTERNS.STUDENT.updated))
  async onStudentUpdated(@Payload() data: unknown): Promise<void> {
    const { tenantId, changedFields } =
      eventPayloadSchemas[EVENT_PATTERNS.STUDENT.updated].parse(data);
    const dimensions = changedFields
      .map((field) => field.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`))
      .filter((dimension) => RULE_DIMENSIONS.has(dimension));
    if (dimensions.length > 0) await this.invalidateByDimensions(tenantId, dimensions);
  }

  /** A student who left drops out of every rule-based group. */
  @EventPattern(EVENT_PATTERNS.STUDENT.left, gatewayConsumer(EVENT_PATTERNS.STUDENT.left))
  async onStudentLeft(@Payload() data: unknown): Promise<void> {
    const { tenantId } = eventPayloadSchemas[EVENT_PATTERNS.STUDENT.left].parse(data);
    await this.invalidateAllDynamic(tenantId);
  }

  @EventPattern(
    EVENT_PATTERNS.STUDENT.removed_from_year,
    gatewayConsumer(EVENT_PATTERNS.STUDENT.removed_from_year),
  )
  async onStudentRemovedFromYear(@Payload() data: unknown): Promise<void> {
    const { tenantId } = eventPayloadSchemas[EVENT_PATTERNS.STUDENT.removed_from_year].parse(data);
    await this.invalidateAllDynamic(tenantId);
  }

  @EventPattern(
    EVENT_PATTERNS.ACADEMIC_YEAR.activated,
    gatewayConsumer(EVENT_PATTERNS.ACADEMIC_YEAR.activated),
  )
  async onAcademicYearActivated(@Payload() data: unknown): Promise<void> {
    const { tenantId } = eventPayloadSchemas[EVENT_PATTERNS.ACADEMIC_YEAR.activated].parse(data);
    await this.invalidateAllDynamic(tenantId);
  }

  /** A section's shift or medium is read by rules through the student's placement. */
  @EventPattern(EVENT_PATTERNS.SECTION.updated, gatewayConsumer(EVENT_PATTERNS.SECTION.updated))
  async onSectionUpdated(@Payload() data: unknown): Promise<void> {
    const { tenantId } = eventPayloadSchemas[EVENT_PATTERNS.SECTION.updated].parse(data);
    await this.invalidateByDimensions(tenantId, ['shift', 'medium']);
  }

  @EventPattern(EVENT_PATTERNS.SECTION.deleted, gatewayConsumer(EVENT_PATTERNS.SECTION.deleted))
  async onSectionDeleted(@Payload() data: unknown): Promise<void> {
    const { tenantId } = eventPayloadSchemas[EVENT_PATTERNS.SECTION.deleted].parse(data);
    await this.invalidateByDimensions(tenantId, ['section_id']);
  }

  @EventPattern(
    EVENT_PATTERNS.GROUP.rules_updated,
    gatewayConsumer(EVENT_PATTERNS.GROUP.rules_updated),
  )
  async onGroupRulesUpdated(@Payload() data: unknown): Promise<void> {
    const { groupId, tenantId } =
      eventPayloadSchemas[EVENT_PATTERNS.GROUP.rules_updated].parse(data);
    const count = await this.invalidate(tenantId, eq(groups.id, groupId));
    this.logger.log(`Group ${groupId} rules updated: invalidated ${count} group`);
  }

  private async invalidateByDimensions(tenantId: string, dimensions: string[]): Promise<void> {
    const count = await withTenant(this.db, mkInstituteCtx(tenantId, ORIGIN), (tx) =>
      this.invalidateIn(
        tx,
        inArray(
          groups.id,
          tx
            .select({ id: groupRulesLive.groupId })
            .from(groupRulesLive)
            .where(arrayOverlaps(groupRulesLive.ruleDimensions, dimensions)),
        ),
      ),
    );
    this.logger.log(`Invalidated ${count} groups for dimensions: ${dimensions.join(', ')}`);
  }

  private async invalidateAllDynamic(tenantId: string): Promise<void> {
    const count = await this.invalidate(
      tenantId,
      inArray(groups.membershipType, [GroupMembershipType.DYNAMIC, GroupMembershipType.HYBRID]),
    );
    this.logger.log(`Invalidated all ${count} dynamic/hybrid groups`);
  }

  private invalidate(tenantId: string, where: SQL): Promise<number> {
    return withTenant(this.db, mkInstituteCtx(tenantId, ORIGIN), (tx) =>
      this.invalidateIn(tx, where),
    );
  }

  private async invalidateIn(tx: DrizzleDB, where: SQL): Promise<number> {
    const rows = await tx
      .update(groups)
      .set({ resolvedAt: null })
      .where(and(where, isNull(groups.deletedAt)))
      .returning({ id: groups.id });
    return rows.length;
  }
}
