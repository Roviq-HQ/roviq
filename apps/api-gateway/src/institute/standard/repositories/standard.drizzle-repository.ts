import { Inject, Injectable } from '@nestjs/common';
import { BusinessException, ErrorCode } from '@roviq/common-types';
import {
  academicYearsLive,
  DRIZZLE_DB,
  type DrizzleDB,
  mapUniqueViolation,
  mkInstituteCtx,
  softDelete,
  standards,
  standardsLive,
  type UniqueViolationErrors,
  withTenant,
} from '@roviq/database';
import { getRequestContext } from '@roviq/request-context';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { StandardRepository } from './standard.repository';
import type {
  CreateStandardData,
  CreateStandardResult,
  StandardRecord,
  UpdateStandardData,
} from './types';

// Read projection — `standards_live` view excludes soft-deleted rows.
const liveColumns = {
  id: standardsLive.id,
  tenantId: standardsLive.tenantId,
  academicYearId: standardsLive.academicYearId,
  name: standardsLive.name,
  numericOrder: standardsLive.numericOrder,
  level: standardsLive.level,
  nepStage: standardsLive.nepStage,
  department: standardsLive.department,
  isBoardExamClass: standardsLive.isBoardExamClass,
  streamApplicable: standardsLive.streamApplicable,
  maxSectionsAllowed: standardsLive.maxSectionsAllowed,
  maxStudentsPerSection: standardsLive.maxStudentsPerSection,
  udiseClassCode: standardsLive.udiseClassCode,
  createdAt: standardsLive.createdAt,
  updatedAt: standardsLive.updatedAt,
} as const;

// Same projection on the base table — used by INSERT/UPDATE … RETURNING.
const writeReturning = {
  id: standards.id,
  tenantId: standards.tenantId,
  academicYearId: standards.academicYearId,
  name: standards.name,
  numericOrder: standards.numericOrder,
  level: standards.level,
  nepStage: standards.nepStage,
  department: standards.department,
  isBoardExamClass: standards.isBoardExamClass,
  streamApplicable: standards.streamApplicable,
  maxSectionsAllowed: standards.maxSectionsAllowed,
  maxStudentsPerSection: standards.maxStudentsPerSection,
  udiseClassCode: standards.udiseClassCode,
  createdAt: standards.createdAt,
  updatedAt: standards.updatedAt,
} as const;

const STANDARD_TAKEN: UniqueViolationErrors = {
  standards_tenant_year_name_key: () =>
    new BusinessException(
      ErrorCode.STANDARD_NAME_DUPLICATE,
      'A standard with this name already exists in this academic year',
    ),
  standards_tenant_year_order_key: () =>
    new BusinessException(
      ErrorCode.STANDARD_ORDER_DUPLICATE,
      'A standard with this numeric order already exists in this academic year',
    ),
};

@Injectable()
export class StandardDrizzleRepository extends StandardRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDB) {
    super();
  }

  private getTenantId(): string {
    const { tenantId } = getRequestContext();
    if (!tenantId) throw new Error('Tenant context is required');
    return tenantId;
  }

  async findById(id: string): Promise<StandardRecord | null> {
    const tenantId = this.getTenantId();
    return withTenant(this.db, mkInstituteCtx(tenantId, 'repository:standard'), async (tx) => {
      const rows = await tx.select(liveColumns).from(standardsLive).where(eq(standardsLive.id, id));
      return (rows[0] as StandardRecord | undefined) ?? null;
    });
  }

  async findByAcademicYear(academicYearId: string): Promise<StandardRecord[]> {
    const tenantId = this.getTenantId();
    return withTenant(this.db, mkInstituteCtx(tenantId, 'repository:standard'), async (tx) => {
      return tx
        .select(liveColumns)
        .from(standardsLive)
        .where(eq(standardsLive.academicYearId, academicYearId))
        .orderBy(asc(standardsLive.numericOrder)) as Promise<StandardRecord[]>;
    });
  }

  async create(data: CreateStandardData): Promise<CreateStandardResult> {
    const tenantId = this.getTenantId();
    const { userId } = getRequestContext();
    return withTenant<CreateStandardResult>(
      this.db,
      mkInstituteCtx(tenantId, 'repository:standard'),
      async (tx) => {
        // The foreign key accepts any institute's year; RLS on the view does not.
        const [year] = await tx
          .select({ id: academicYearsLive.id })
          .from(academicYearsLive)
          .where(eq(academicYearsLive.id, data.academicYearId))
          .limit(1);
        if (!year) return { kind: 'year_not_found' };

        const rows = await tx
          .insert(standards)
          .values({
            tenantId,
            academicYearId: data.academicYearId,
            name: data.name,
            numericOrder: data.numericOrder,
            level: data.level as (typeof standards.level.enumValues)[number] | undefined,
            nepStage: data.nepStage as (typeof standards.nepStage.enumValues)[number] | undefined,
            department: data.department,
            isBoardExamClass: data.isBoardExamClass,
            streamApplicable: data.streamApplicable,
            maxSectionsAllowed: data.maxSectionsAllowed,
            maxStudentsPerSection: data.maxStudentsPerSection,
            udiseClassCode: data.udiseClassCode,
            createdBy: userId,
            updatedBy: userId,
          })
          .returning(writeReturning);
        return { kind: 'ok', record: rows[0] as StandardRecord };
      },
    ).catch(mapUniqueViolation(STANDARD_TAKEN));
  }

  async update(id: string, data: UpdateStandardData): Promise<StandardRecord> {
    const tenantId = this.getTenantId();
    const { userId } = getRequestContext();
    return withTenant(this.db, mkInstituteCtx(tenantId, 'repository:standard'), async (tx) => {
      const rows = await tx
        .update(standards)
        .set({
          ...(data.name !== undefined && { name: data.name }),
          ...(data.numericOrder !== undefined && { numericOrder: data.numericOrder }),
          ...(data.level !== undefined && {
            level: data.level as (typeof standards.level.enumValues)[number] | undefined,
          }),
          ...(data.nepStage !== undefined && {
            nepStage: data.nepStage as (typeof standards.nepStage.enumValues)[number] | undefined,
          }),
          ...(data.department !== undefined && { department: data.department }),
          ...(data.isBoardExamClass !== undefined && { isBoardExamClass: data.isBoardExamClass }),
          ...(data.streamApplicable !== undefined && { streamApplicable: data.streamApplicable }),
          ...(data.maxSectionsAllowed !== undefined && {
            maxSectionsAllowed: data.maxSectionsAllowed,
          }),
          ...(data.maxStudentsPerSection !== undefined && {
            maxStudentsPerSection: data.maxStudentsPerSection,
          }),
          ...(data.udiseClassCode !== undefined && { udiseClassCode: data.udiseClassCode }),
          updatedBy: userId,
        })
        .where(and(eq(standards.id, id), isNull(standards.deletedAt)))
        .returning(writeReturning);

      if (rows.length === 0)
        throw new BusinessException(ErrorCode.STANDARD_NOT_FOUND, `Standard ${id} not found`);
      return rows[0] as StandardRecord;
    }).catch(mapUniqueViolation(STANDARD_TAKEN));
  }

  async softDelete(id: string): Promise<void> {
    const tenantId = this.getTenantId();
    await withTenant(this.db, mkInstituteCtx(tenantId, 'repository:standard'), async (tx) => {
      await softDelete(tx, standards, id);
    });
  }
}
