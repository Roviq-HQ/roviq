import { Inject, Injectable } from '@nestjs/common';
import { caslToSqlWhere, type InstituteReadAccess } from '@roviq/casl';
import {
  AdmissionApplicationStatus,
  type AppAbility,
  BusinessException,
  EnquiryStatus,
  ErrorCode,
  FUNNEL_STAGES,
  type InstituteContext,
} from '@roviq/common-types';
import {
  admissionApplicationsLive,
  DRIZZLE_DB,
  type DrizzleDB,
  enquiriesLive,
  withTenant,
} from '@roviq/database';
import { and, count, eq, gte, lte, type SQL, sql } from 'drizzle-orm';
import { decodeCursor, encodeCursor } from '../../common/pagination/relay-pagination.model';
import { toApplicationModel, toEnquiryModel } from './admission-records';
import type { AdmissionStatisticsFilterInput } from './dto/admission-statistics-filter.input';
import type { ApplicationFilterInput, EnquiryFilterInput } from './dto/enquiry-filter.input';
import type { AdmissionStatisticsModel } from './models/admission-statistics.model';
import type { ApplicationModel } from './models/application.model';
import type { EnquiryModel } from './models/enquiry.model';

function admissionReadPredicate(ability: AppAbility, subject: 'Enquiry' | 'Application') {
  return subject === 'Enquiry'
    ? caslToSqlWhere(ability, 'read', subject, {
        id: enquiriesLive.id,
        tenantId: enquiriesLive.tenantId,
        assignedTo: enquiriesLive.assignedTo,
        createdBy: enquiriesLive.createdBy,
        academicYearId: enquiriesLive.academicYearId,
        status: enquiriesLive.status,
      })
    : caslToSqlWhere(ability, 'read', subject, {
        id: admissionApplicationsLive.id,
        tenantId: admissionApplicationsLive.tenantId,
        createdBy: admissionApplicationsLive.createdBy,
        academicYearId: admissionApplicationsLive.academicYearId,
        standardId: admissionApplicationsLive.standardId,
        sectionId: admissionApplicationsLive.sectionId,
        status: admissionApplicationsLive.status,
        enquiryId: admissionApplicationsLive.enquiryId,
        studentProfileId: admissionApplicationsLive.studentProfileId,
      });
}

@Injectable()
export class AdmissionReadRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDB) {}
  getApplication(id: string, access: InstituteReadAccess) {
    return this.loadApplication(
      id,
      access.user,
      admissionReadPredicate(access.ability, 'Application'),
    );
  }
  getForMutation(id: string, ctx: InstituteContext) {
    return this.loadApplication(id, ctx, undefined);
  }
  async isVisible(id: string, subject: 'Enquiry' | 'Application', access: InstituteReadAccess) {
    const table = subject === 'Enquiry' ? enquiriesLive : admissionApplicationsLive;
    const rows = await withTenant(this.db, access.user, (tx) =>
      tx
        .select({ id: table.id })
        .from(table)
        .where(and(eq(table.id, id), admissionReadPredicate(access.ability, subject)))
        .limit(1),
    );
    return rows.length > 0;
  }
  async listEnquiries(
    filter: EnquiryFilterInput,
    access: InstituteReadAccess,
  ): Promise<{
    edges: { node: EnquiryModel; cursor: string }[];
    totalCount: number;
    pageInfo: {
      hasNextPage: boolean;
      hasPreviousPage: boolean;
      startCursor: string | null;
      endCursor: string | null;
    };
  }> {
    const limit = filter.first ?? 25;

    const restriction = admissionReadPredicate(access.ability, 'Enquiry');
    const conditions: SQL[] = restriction ? [restriction] : [];
    if (filter.status) conditions.push(eq(enquiriesLive.status, filter.status));
    if (filter.source) conditions.push(eq(enquiriesLive.source, filter.source));
    if (filter.classRequested)
      conditions.push(eq(enquiriesLive.classRequested, filter.classRequested));
    if (filter.assignedTo) conditions.push(eq(enquiriesLive.assignedTo, filter.assignedTo));
    if (filter.followUpFrom) conditions.push(gte(enquiriesLive.followUpDate, filter.followUpFrom));
    if (filter.followUpTo) conditions.push(lte(enquiriesLive.followUpDate, filter.followUpTo));
    if (filter.overdueOnly) {
      conditions.push(
        sql`${enquiriesLive.followUpDate} < CURRENT_DATE AND ${enquiriesLive.status} NOT IN (${EnquiryStatus.ENROLLED}, ${EnquiryStatus.LOST}, ${EnquiryStatus.DROPPED})`,
      );
    }
    if (filter.search) {
      conditions.push(
        sql`to_tsvector('simple', coalesce(${enquiriesLive.studentName}, '') || ' ' || coalesce(${enquiriesLive.parentName}, '')) @@ plainto_tsquery('simple', ${filter.search})`,
      );
    }

    let cursorCondition: ReturnType<typeof sql> | undefined;
    if (filter.after) {
      const decoded = decodeCursor(filter.after);
      cursorCondition = sql`${enquiriesLive.id} > ${decoded.id}`;
    }

    const where = and(
      ...(conditions.length > 0 ? conditions : []),
      ...(cursorCondition ? [cursorCondition] : []),
    );

    return withTenant(this.db, access.user, async (tx) => {
      const countWhere = conditions.length > 0 ? and(...conditions) : undefined;
      const [{ total }] = await tx.select({ total: count() }).from(enquiriesLive).where(countWhere);

      // Sort: overdue follow-ups first, then by follow_up_date ascending
      const rows = await tx
        .select()
        .from(enquiriesLive)
        .where(where)
        .orderBy(
          sql`CASE WHEN ${enquiriesLive.followUpDate} < CURRENT_DATE THEN 0 ELSE 1 END`,
          sql`${enquiriesLive.followUpDate} ASC NULLS LAST`,
          enquiriesLive.id,
        )
        .limit(limit + 1);

      const hasNextPage = rows.length > limit;
      if (hasNextPage) rows.pop();

      const edges = rows.map((row) => ({
        node: toEnquiryModel(row),
        cursor: encodeCursor({ id: row.id }),
      }));

      return {
        edges,
        totalCount: total,
        pageInfo: {
          hasNextPage,
          hasPreviousPage: !!filter.after,
          startCursor: edges[0]?.cursor ?? null,
          endCursor: edges[edges.length - 1]?.cursor ?? null,
        },
      };
    });
  }

  async listApplications(
    filter: ApplicationFilterInput,
    access: InstituteReadAccess,
  ): Promise<{
    edges: { node: ApplicationModel; cursor: string }[];
    totalCount: number;
    pageInfo: {
      hasNextPage: boolean;
      hasPreviousPage: boolean;
      startCursor: string | null;
      endCursor: string | null;
    };
  }> {
    const limit = filter.first ?? 25;

    const restriction = admissionReadPredicate(access.ability, 'Application');
    const conditions: SQL[] = restriction ? [restriction] : [];
    if (filter.status) conditions.push(eq(admissionApplicationsLive.status, filter.status));
    if (filter.academicYearId) {
      conditions.push(eq(admissionApplicationsLive.academicYearId, filter.academicYearId));
    }
    if (filter.standardId) {
      conditions.push(eq(admissionApplicationsLive.standardId, filter.standardId));
    }
    if (filter.isRteApplication !== undefined) {
      conditions.push(eq(admissionApplicationsLive.isRteApplication, filter.isRteApplication));
    }

    let cursorCondition: ReturnType<typeof sql> | undefined;
    if (filter.after) {
      const decoded = decodeCursor(filter.after);
      cursorCondition = sql`${admissionApplicationsLive.id} > ${decoded.id}`;
    }

    const where = and(
      ...(conditions.length > 0 ? conditions : []),
      ...(cursorCondition ? [cursorCondition] : []),
    );

    return withTenant(this.db, access.user, async (tx) => {
      const countWhere = conditions.length > 0 ? and(...conditions) : undefined;
      const [{ total }] = await tx
        .select({ total: count() })
        .from(admissionApplicationsLive)
        .where(countWhere);

      const rows = await tx
        .select()
        .from(admissionApplicationsLive)
        .where(where)
        .orderBy(admissionApplicationsLive.createdAt)
        .limit(limit + 1);

      const hasNextPage = rows.length > limit;
      if (hasNextPage) rows.pop();

      const edges = rows.map((row) => ({
        node: toApplicationModel(row),
        cursor: encodeCursor({ id: row.id }),
      }));

      return {
        edges,
        totalCount: total,
        pageInfo: {
          hasNextPage,
          hasPreviousPage: !!filter.after,
          startCursor: edges[0]?.cursor ?? null,
          endCursor: edges[edges.length - 1]?.cursor ?? null,
        },
      };
    });
  }

  private async loadApplication(
    id: string,
    ctx: InstituteContext,
    restriction: SQL | undefined,
  ): Promise<ApplicationModel> {
    const rows = await withTenant(this.db, ctx, async (tx) => {
      return tx
        .select()
        .from(admissionApplicationsLive)
        .where(and(eq(admissionApplicationsLive.id, id), restriction))
        .limit(1);
    });

    if (rows.length === 0) {
      throw new BusinessException(ErrorCode.APPLICATION_NOT_FOUND, 'Application not found');
    }
    return toApplicationModel(rows[0]);
  }

  async statistics(
    access: InstituteReadAccess,
    filter?: AdmissionStatisticsFilterInput,
  ): Promise<AdmissionStatisticsModel> {
    const enqRestriction = admissionReadPredicate(access.ability, 'Enquiry');
    const appRestriction = admissionReadPredicate(access.ability, 'Application');

    // Build inclusive date-range predicates against `created_at`, anchored
    // to **Asia/Kolkata** (the canonical timezone for every Indian institute).
    // We push the conversion into Postgres via `AT TIME ZONE` rather than
    // synthesising a `Date` here so the comparison happens against the row's
    // own timestamp in IST. Without this, `to: '2026-04-15'` would match in
    // UTC and silently drop events created between 23:30–24:00 IST.
    //
    //   from → IST midnight at the start of the day  (>=)
    //   to   → IST 23:59:59.999999 at the end of the day  (<=)
    //
    // `from`/`to` are validated by class-validator as `IsDateString()` so
    // they are safe to interpolate into SQL via `sql`.
    const enquiryWindow = (() => {
      const conds: SQL[] = [];
      if (filter?.from) {
        conds.push(
          sql`${enquiriesLive.createdAt} >= (${filter.from}::date AT TIME ZONE 'Asia/Kolkata')`,
        );
      }
      if (filter?.to) {
        conds.push(
          sql`${enquiriesLive.createdAt} < ((${filter.to}::date + INTERVAL '1 day') AT TIME ZONE 'Asia/Kolkata')`,
        );
      }
      return conds.length > 0 ? and(...conds) : undefined;
    })();

    const appWindow = (() => {
      const conds: SQL[] = [];
      if (filter?.from) {
        conds.push(
          sql`${admissionApplicationsLive.createdAt} >= (${filter.from}::date AT TIME ZONE 'Asia/Kolkata')`,
        );
      }
      if (filter?.to) {
        conds.push(
          sql`${admissionApplicationsLive.createdAt} < ((${filter.to}::date + INTERVAL '1 day') AT TIME ZONE 'Asia/Kolkata')`,
        );
      }
      return conds.length > 0 ? and(...conds) : undefined;
    })();

    return withTenant(this.db, access.user, async (tx) => {
      const [{ totalEnq }] = await tx
        .select({ totalEnq: count() })
        .from(enquiriesLive)
        .where(and(enquiryWindow, enqRestriction));
      const [{ totalApp }] = await tx
        .select({ totalApp: count() })
        .from(admissionApplicationsLive)
        .where(and(appWindow, appRestriction));

      // Funnel: count applications at or past each stage
      const statusCounts = await tx
        .select({ status: admissionApplicationsLive.status, cnt: count() })
        .from(admissionApplicationsLive)
        .where(and(appWindow, appRestriction))
        .groupBy(admissionApplicationsLive.status);

      const statusMap = new Map(statusCounts.map((r) => [r.status, r.cnt]));

      const funnel = FUNNEL_STAGES.map((stage) => ({
        stage,
        count: statusMap.get(stage) ?? 0,
      }));

      // Source breakdown — enquiryCount per source plus the number of those
      // enquiries that converted to an application. The applicationCount is
      // computed via a LEFT JOIN to admission_applications keyed on the
      // enquiry FK so counts correctly reflect cross-over between tables.
      const bySourceRows = await tx
        .select({
          source: enquiriesLive.source,
          enquiryCount: sql<number>`COUNT(${enquiriesLive.id})::int`,
          applicationCount: sql<number>`COUNT(${admissionApplicationsLive.id})::int`,
        })
        .from(enquiriesLive)
        .leftJoin(
          admissionApplicationsLive,
          and(eq(admissionApplicationsLive.enquiryId, enquiriesLive.id), appRestriction),
        )
        .where(and(enquiryWindow, enqRestriction))
        .groupBy(enquiriesLive.source);

      const bySource = bySourceRows.map((r) => ({
        source: r.source,
        enquiryCount: r.enquiryCount,
        applicationCount: r.applicationCount,
      }));

      // Conversion rates
      const enrolledCount = statusMap.get(AdmissionApplicationStatus.ENROLLED) ?? 0;
      const enquiryToApplicationRate = totalEnq > 0 ? totalApp / totalEnq : 0;
      const applicationToEnrolledRate = totalApp > 0 ? enrolledCount / totalApp : 0;

      return {
        totalEnquiries: totalEnq,
        totalApplications: totalApp,
        funnel,
        bySource,
        enquiryToApplicationRate,
        applicationToEnrolledRate,
      };
    });
  }
}
