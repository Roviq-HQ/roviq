import { Inject, Injectable, Logger } from '@nestjs/common';
import { seedDefaultRoles } from '@roviq/casl';
import {
  academicYears,
  academicYearsLive,
  DRIZZLE_DB,
  type DrizzleDB,
  instituteConfigs,
  instituteNotificationConfigs,
  institutes,
  mkAdminCtx,
  withAdmin,
} from '@roviq/database';
import { eq } from 'drizzle-orm';
import { InstituteSeederService } from './institute-seeder.service';

export interface SetupInput {
  instituteId: string;
  type: string;
  departments: readonly string[];
  board?: string;
  isDemo?: boolean;
  /** Recorded as createdBy/updatedBy on everything setup writes. */
  actorId: string;
}

export interface AcademicStructureCounts {
  standardsCreated: number;
  sectionsCreated: number;
  subjectsSeeded: number;
}

/** Board-specific section strength norms (PRD §7.3); unknown or missing boards get CBSE's. */
const SECTION_STRENGTH_NORMS: Record<
  string,
  { optimal: number; hardMax: number; exemptionAllowed: boolean }
> = {
  CBSE: { optimal: 40, hardMax: 45, exemptionAllowed: true },
  BSEH: { optimal: 40, hardMax: 45, exemptionAllowed: true },
  RBSE: { optimal: 40, hardMax: 45, exemptionAllowed: true },
  ICSE: { optimal: 35, hardMax: 40, exemptionAllowed: false },
};

const DEFAULT_NOTIFICATION_TYPES = ['FEE', 'ATTENDANCE', 'APPROVAL'];

/**
 * The one implementation of institute setup. Direct creation runs it in process through
 * `runSetup`; the approval path runs the same steps as InstituteSetupWorkflow activities.
 * Every step is idempotent and can be retried on its own.
 */
@Injectable()
export class InstituteSetupService {
  private readonly logger = new Logger(InstituteSetupService.name);

  constructor(
    @Inject(DRIZZLE_DB) private readonly db: DrizzleDB,
    private readonly seeder: InstituteSeederService,
  ) {}

  async runSetup(input: SetupInput): Promise<void> {
    const { instituteId, type, departments, board, actorId } = input;
    this.logger.log(`Starting setup for institute ${instituteId} (type=${type})`);

    try {
      await this.updateSetupStatus(instituteId, 'IN_PROGRESS', actorId);
      await this.createDefaultRoles(instituteId);
      await this.createDefaultNotificationConfig(instituteId, actorId);
      await this.createInstituteConfig(instituteId, board, actorId);
      const academicYearId = await this.createFirstAcademicYear(instituteId, actorId);
      await this.seedAcademicStructure({
        instituteId,
        academicYearId,
        type,
        departments,
        board,
        actorId,
      });
      await this.updateSetupStatus(instituteId, 'COMPLETED', actorId);
      this.logger.log(`Setup completed for institute ${instituteId}`);
    } catch (error) {
      this.logger.error(`Setup failed for institute ${instituteId}`, error);
      await this.updateSetupStatus(instituteId, 'FAILED', actorId);
      throw error;
    }
  }

  /** The default institute roles (admin, principal, teacher, student, parent …). */
  async createDefaultRoles(instituteId: string): Promise<void> {
    await seedDefaultRoles(this.db, instituteId);
  }

  async createDefaultNotificationConfig(instituteId: string, actorId: string): Promise<void> {
    await withAdmin(this.db, mkAdminCtx('seeder:institute-setup.service'), async (tx) => {
      for (const notificationType of DEFAULT_NOTIFICATION_TYPES) {
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

  /** The config row carries the board's section norms; readers otherwise fall back to CBSE's. */
  async createInstituteConfig(
    instituteId: string,
    board: string | undefined,
    actorId: string,
  ): Promise<void> {
    const sectionStrengthNorms =
      (board && SECTION_STRENGTH_NORMS[board]) || SECTION_STRENGTH_NORMS.CBSE;
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

  /** First academic year, active (Indian: April–March). Returns the existing one on retry. */
  async createFirstAcademicYear(instituteId: string, actorId: string): Promise<string> {
    const now = new Date();
    const startYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    const label = `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;

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
          label,
          startDate: `${startYear}-04-01`,
          endDate: `${startYear + 1}-03-31`,
          isActive: true,
          status: 'ACTIVE',
          createdBy: actorId,
          updatedBy: actorId,
        })
        .returning({ id: academicYears.id });
      return rows[0].id;
    });
  }

  /** Standards, sections and board subjects by institute type; coaching institutes get none. */
  async seedAcademicStructure(input: {
    instituteId: string;
    academicYearId: string;
    type: string;
    departments: readonly string[];
    board: string | undefined;
    actorId: string;
  }): Promise<AcademicStructureCounts> {
    const { instituteId, academicYearId, type, departments, board, actorId } = input;
    if (type === 'LIBRARY') {
      await this.seeder.seedLibrary(instituteId, academicYearId, actorId);
      return { standardsCreated: 1, sectionsCreated: 2, subjectsSeeded: 0 };
    }
    if (type !== 'SCHOOL') return { standardsCreated: 0, sectionsCreated: 0, subjectsSeeded: 0 };

    const standardIds = await this.seeder.seedStandards(
      instituteId,
      academicYearId,
      departments,
      board,
      actorId,
    );
    let sectionsCreated = 0;
    for (const standardId of standardIds) {
      const sectionIds = await this.seeder.seedSections(
        instituteId,
        standardId,
        academicYearId,
        actorId,
      );
      sectionsCreated += sectionIds.length;
    }
    const subjectIds = board
      ? await this.seeder.seedSubjects(instituteId, academicYearId, board, actorId)
      : [];
    return {
      standardsCreated: standardIds.length,
      sectionsCreated,
      // Templates repeat a subject per class band; count each subject once.
      subjectsSeeded: new Set(subjectIds).size,
    };
  }

  private async updateSetupStatus(
    instituteId: string,
    status: 'IN_PROGRESS' | 'COMPLETED' | 'FAILED',
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
