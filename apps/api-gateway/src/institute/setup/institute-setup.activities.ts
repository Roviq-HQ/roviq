/**
 * Activities for InstituteSetupWorkflow (ROV-126, PRD §10.4).
 *
 * Each activity is idempotent — checks "exists?" before creating.
 *
 * Temporal activities must accept only serializable arguments.
 * The DrizzleDB, EventBusService and InstituteSetupService are injected at worker startup via
 * closure; the setup steps themselves live in InstituteSetupService, shared with direct creation.
 */
import { Logger } from '@nestjs/common';
import {
  type DrizzleDB,
  instituteNotificationConfigs,
  institutes,
  mkAdminCtx,
  withAdmin,
} from '@roviq/database';
import type { EventBusService } from '@roviq/event-bus';
import { EVENT_PATTERNS } from '@roviq/nats-jetstream';
import { eq } from 'drizzle-orm';
import type { InstituteSetupService } from '../management/seed/institute-setup.service';
import type { InstituteSetupActivities, InstituteSetupProgress } from './institute-setup.types';

const logger = new Logger('InstituteSetupActivities');

/**
 * Create activity implementations bound to a DrizzleDB instance and the event bus.
 * Called at Temporal worker startup — activities close over the connections.
 */
export function createInstituteSetupActivities(
  db: DrizzleDB,
  eventBus: Pick<EventBusService, 'emit'>,
  setup: Pick<
    InstituteSetupService,
    | 'createDefaultRoles'
    | 'createFirstAdmin'
    | 'createDefaultNotificationConfig'
    | 'createInstituteConfig'
    | 'createFirstAcademicYear'
    | 'seedAcademicStructure'
  >,
): InstituteSetupActivities {
  return {
    // ── Phase 1: Identity ──────────────────────────────────

    async createDefaultRoles(instituteId: string, _creatingUserId: string): Promise<void> {
      await setup.createDefaultRoles(instituteId);
    },

    async createFirstAdmin(instituteId: string, creatingUserId: string): Promise<void> {
      await setup.createFirstAdmin(instituteId, creatingUserId);
    },

    // ── Phase 2: Infrastructure ────────────────────────────

    /**
     * Create wallets via Finance Service NATS call.
     * TODO: Replace stub when Finance Service is built.
     */
    async createWallets(instituteId: string): Promise<void> {
      logger.log(
        `[STUB] NATS → FINANCE.createWallets: fund, virtual, cash, expense for ${instituteId}`,
      );
      // TODO: Actual NATS call to Finance Service
    },

    // ── Phase 3: Academic Structure ────────────────────────

    async seedAcademicStructure(
      instituteId: string,
      academicYearId: string,
      departments: string[],
      board: string | undefined,
      type: string,
      creatingUserId: string,
    ) {
      return setup.seedAcademicStructure({
        instituteId,
        academicYearId,
        type,
        departments,
        board,
        actorId: creatingUserId,
      });
    },

    // ── Phase 4: Configuration ─────────────────────────────

    async createDefaultNotificationConfig(
      instituteId: string,
      creatingUserId: string,
    ): Promise<void> {
      await setup.createDefaultNotificationConfig(instituteId, creatingUserId);
    },

    async createInstituteConfig(
      instituteId: string,
      board: string | undefined,
      creatingUserId: string,
    ): Promise<void> {
      await setup.createInstituteConfig(instituteId, board, creatingUserId);
    },

    async createFirstAcademicYear(instituteId: string, creatingUserId: string): Promise<string> {
      return setup.createFirstAcademicYear(instituteId, creatingUserId);
    },

    // ── Phase 5: Demo Data ─────────────────────────────────

    /** Seed demo data — only runs when isDemo=true. Notifications disabled for demo. */
    async seedDemoData(instituteId: string, _creatingUserId: string): Promise<void> {
      logger.log(`[STUB] Seeding demo data for institute ${instituteId}`);
      // TODO: Generate sample students, attendance records, etc.
      // Demo institutes have all notification channels disabled

      // Disable all notification channels for demo institutes
      await withAdmin(db, mkAdminCtx('seeder:institute-setup.activities'), async (tx) => {
        await tx
          .update(instituteNotificationConfigs)
          .set({
            inAppEnabled: false,
            whatsappEnabled: false,
            emailEnabled: false,
            pushEnabled: false,
          })
          .where(eq(instituteNotificationConfigs.tenantId, instituteId));
      });

      logger.log(`Demo data seeded + notifications disabled for ${instituteId}`);
    },

    // ── Completion ─────────────────────────────────────────

    /** Update institute setup_status */
    async updateSetupStatus(
      instituteId: string,
      status: 'IN_PROGRESS' | 'COMPLETED' | 'FAILED',
      creatingUserId: string,
    ): Promise<void> {
      await withAdmin(db, mkAdminCtx('seeder:institute-setup.activities'), async (tx) => {
        await tx
          .update(institutes)
          .set({
            setupStatus: status,
            updatedBy: creatingUserId,
          })
          .where(eq(institutes.id, instituteId));
      });

      if (status === 'COMPLETED') {
        eventBus.emit(EVENT_PATTERNS.INSTITUTE.setup_completed, {
          instituteId,
          tenantId: instituteId,
        });
      }

      logger.log(`Setup status → ${status} for institute ${instituteId}`);
    },

    /** Publish progress for the instituteSetupProgress subscriptions (NATS and GraphQL pubsub). */
    async publishProgress(progress: InstituteSetupProgress): Promise<void> {
      eventBus.emit(EVENT_PATTERNS.INSTITUTE.setup_progress, {
        ...progress,
        tenantId: progress.instituteId,
      });
    },
  };
}
