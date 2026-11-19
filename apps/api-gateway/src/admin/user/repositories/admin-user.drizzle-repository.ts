import { Inject, Injectable } from '@nestjs/common';
import {
  authEvents,
  DRIZZLE_DB,
  type DrizzleDB,
  filesLive,
  institutesLive,
  membershipsLive,
  mkAdminCtx,
  phoneNumbersLive,
  platformMembershipsLive,
  resellerMembershipsLive,
  resellersLive,
  rolesLive,
  userAddressesLive,
  userDocumentFilesLive,
  userDocumentsLive,
  userIdentifiersLive,
  userProfilesLive,
  usersLive,
  withAdmin,
} from '@roviq/database';
import {
  and,
  asc,
  count,
  countDistinct,
  desc,
  eq,
  exists,
  gte,
  inArray,
  lte,
  not,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
import { decodeCursor, encodeCursor } from '../../../common/pagination/relay-pagination.model';
import { fileLiveColumns } from '../../../files/repositories/file-columns';
import type { FileRecord } from '../../../files/repositories/types';
import { loadUserDocumentFiles } from '../../../files/user-document-files';
import { AdminUserRepository } from './admin-user.repository';
import type {
  AdminUserDetailRecord,
  AdminUserIdentifierRecord,
  AdminUserListQuery,
  AdminUserListResult,
  AdminUserMembershipRecord,
  AdminUserPhoneRecord,
  AdminUserRecord,
  AdminUserStatisticsRecord,
} from './types';

/** Auth events that prove the user was using the app at that moment. */
const ACTIVITY_EVENT_TYPES = ['login_success', 'token_refresh', 'institute_switch'];

/** Encrypted identifier types: only the stored mask may leave the database. */
const SENSITIVE_IDENTIFIER_TYPES = new Set(['AADHAAR', 'PAN']);

const DAY_MS = 24 * 60 * 60 * 1000;

/** Postgres text form keeps microseconds; a JS Date would round them away and skip rows. */
const createdAtText = sql<string>`${usersLive.createdAt}::text`;

/** Builds a prefix tsquery from free text; punctuation would make to_tsquery throw. */
function toPrefixTsQuery(term: string): string | null {
  const words = term
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter((w) => w.length > 0);
  return words.length > 0 ? words.map((w) => `${w}:*`).join(' & ') : null;
}

/** Aadhaar is shown as its last four digits only, whatever format the stored mask uses. */
export function identifierDisplayValue(
  type: string,
  valueMasked: string | null,
  valuePlain: string | null,
): string | null {
  if (!SENSITIVE_IDENTIFIER_TYPES.has(type)) return valuePlain ?? valueMasked;
  if (!valueMasked) return null;
  if (type !== 'AADHAAR') return valueMasked;
  const lastFour = valueMasked.replace(/\D/g, '').slice(-4);
  return lastFour.length === 4 ? `XXXX XXXX ${lastFour}` : null;
}

@Injectable()
export class AdminUserDrizzleRepository extends AdminUserRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDB) {
    super();
  }

  private readonly lastActiveAt = sql<Date | null>`(
    SELECT max(ae.created_at) FROM auth_events ae
    WHERE ae.user_id = ${usersLive.id}
    AND ae.event_type IN (${sql.join(
      ACTIVITY_EVENT_TYPES.map((t) => sql`${t}`),
      sql`, `,
    )})
  )`.mapWith(authEvents.createdAt);

  private searchCondition(tx: DrizzleDB, rawTerm: string): SQL | undefined {
    const term = rawTerm.trim();
    if (term.length === 0) return undefined;
    const pattern = `%${term}%`;
    const tsQuery = toPrefixTsQuery(term);
    return or(
      tsQuery
        ? sql`${userProfilesLive.searchVector} @@ to_tsquery('simple', ${tsQuery})`
        : undefined,
      sql`${usersLive.username} ILIKE ${pattern}`,
      sql`${usersLive.email} ILIKE ${pattern}`,
      exists(
        tx
          .select({ one: sql`1` })
          .from(phoneNumbersLive)
          .where(
            and(
              eq(phoneNumbersLive.userId, usersLive.id),
              sql`${phoneNumbersLive.number} ILIKE ${pattern}`,
            ),
          ),
      ),
    );
  }

  private membershipFilters(tx: DrizzleDB, query: AdminUserListQuery): SQL[] {
    const conditions: SQL[] = [];
    const instituteMembership = (tenantId?: string) =>
      exists(
        tx
          .select({ one: sql`1` })
          .from(membershipsLive)
          .where(
            and(
              eq(membershipsLive.userId, usersLive.id),
              tenantId ? eq(membershipsLive.tenantId, tenantId) : undefined,
            ),
          ),
      );
    const platformMembership = exists(
      tx
        .select({ one: sql`1` })
        .from(platformMembershipsLive)
        .where(eq(platformMembershipsLive.userId, usersLive.id)),
    );
    const resellerMembership = exists(
      tx
        .select({ one: sql`1` })
        .from(resellerMembershipsLive)
        .where(eq(resellerMembershipsLive.userId, usersLive.id)),
    );

    if (query.tenantId) conditions.push(instituteMembership(query.tenantId));
    if (query.hasInstituteMembership !== undefined) {
      const c = instituteMembership();
      conditions.push(query.hasInstituteMembership ? c : not(c));
    }
    if (query.hasPlatformMembership !== undefined) {
      conditions.push(query.hasPlatformMembership ? platformMembership : not(platformMembership));
    }
    if (query.hasResellerMembership !== undefined) {
      conditions.push(query.hasResellerMembership ? resellerMembership : not(resellerMembership));
    }
    return conditions;
  }

  private async loadMemberships(
    tx: DrizzleDB,
    userIds: string[],
  ): Promise<Map<string, AdminUserMembershipRecord[]>> {
    const byUser = new Map<string, AdminUserMembershipRecord[]>();
    if (userIds.length === 0) return byUser;
    const rows = await tx
      .select({
        id: membershipsLive.id,
        userId: membershipsLive.userId,
        tenantId: membershipsLive.tenantId,
        roleId: membershipsLive.roleId,
        roleName: rolesLive.name,
        status: membershipsLive.status,
        instituteName: institutesLive.name,
        joinedAt: membershipsLive.createdAt,
      })
      .from(membershipsLive)
      .leftJoin(institutesLive, eq(institutesLive.id, membershipsLive.tenantId))
      .leftJoin(rolesLive, eq(rolesLive.id, membershipsLive.roleId))
      .where(inArray(membershipsLive.userId, userIds))
      .orderBy(asc(membershipsLive.createdAt));
    for (const { userId, ...m } of rows) {
      const list = byUser.get(userId) ?? [];
      list.push(m);
      byUser.set(userId, list);
    }
    return byUser;
  }

  private async loadPrimaryPhones(
    tx: DrizzleDB,
    userIds: string[],
  ): Promise<Map<string, AdminUserPhoneRecord>> {
    const byUser = new Map<string, AdminUserPhoneRecord>();
    if (userIds.length === 0) return byUser;
    const rows = await tx
      .select({
        userId: phoneNumbersLive.userId,
        countryCode: phoneNumbersLive.countryCode,
        number: phoneNumbersLive.number,
      })
      .from(phoneNumbersLive)
      .where(and(inArray(phoneNumbersLive.userId, userIds), eq(phoneNumbersLive.isPrimary, true)));
    for (const { userId, ...phone } of rows) byUser.set(userId, phone);
    return byUser;
  }

  private readonly baseColumns = {
    id: usersLive.id,
    email: usersLive.email,
    username: usersLive.username,
    status: usersLive.status,
    createdAt: usersLive.createdAt,
    lastActiveAt: this.lastActiveAt,
    firstName: userProfilesLive.firstName,
    lastName: userProfilesLive.lastName,
    profileImageFileId: userProfilesLive.profileImageFileId,
  };

  private async hydrate(
    tx: DrizzleDB,
    rows: Array<{
      id: string;
      email: string;
      username: string;
      status: AdminUserRecord['status'];
      createdAt: Date;
      lastActiveAt: Date | null;
      firstName: Record<string, string> | null;
      lastName: Record<string, string> | null;
      profileImageFileId: string | null;
    }>,
  ): Promise<AdminUserRecord[]> {
    const ids = rows.map((r) => r.id);
    const [memberships, phones] = await Promise.all([
      this.loadMemberships(tx, ids),
      this.loadPrimaryPhones(tx, ids),
    ]);
    return rows.map(({ firstName, lastName, profileImageFileId, ...row }) => ({
      ...row,
      profile: firstName ? { firstName, lastName, profileImageFileId } : null,
      primaryPhone: phones.get(row.id) ?? null,
      memberships: memberships.get(row.id) ?? [],
    }));
  }

  async list(query: AdminUserListQuery): Promise<AdminUserListResult> {
    return withAdmin(this.db, mkAdminCtx('service:admin-user'), async (tx) => {
      const filters: Array<SQL | undefined> = [
        query.search ? this.searchCondition(tx, query.search) : undefined,
        query.status?.length ? inArray(usersLive.status, query.status) : undefined,
        query.createdAfter ? gte(usersLive.createdAt, query.createdAfter) : undefined,
        query.createdBefore ? lte(usersLive.createdAt, query.createdBefore) : undefined,
        ...this.membershipFilters(tx, query),
      ];
      const where = and(...filters);

      let pageWhere = where;
      if (query.after) {
        const cursor = decodeCursor(query.after);
        if (typeof cursor.createdAt === 'string' && typeof cursor.id === 'string') {
          pageWhere = and(
            where,
            sql`(${usersLive.createdAt}, ${usersLive.id}) < (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)`,
          );
        }
      }

      const [totalRows, rows] = await Promise.all([
        tx
          .select({ value: count() })
          .from(usersLive)
          .leftJoin(userProfilesLive, eq(userProfilesLive.userId, usersLive.id))
          .where(where),
        tx
          .select({ ...this.baseColumns, createdAtText })
          .from(usersLive)
          .leftJoin(userProfilesLive, eq(userProfilesLive.userId, usersLive.id))
          .where(pageWhere)
          .orderBy(desc(usersLive.createdAt), desc(usersLive.id))
          .limit(query.first + 1),
      ]);

      const hasNextPage = rows.length > query.first;
      const page = hasNextPage ? rows.slice(0, query.first) : rows;
      const nodes = await this.hydrate(
        tx,
        page.map(({ createdAtText: _, ...row }) => row),
      );
      return {
        edges: nodes.map((node, i) => ({
          node,
          cursor: encodeCursor({ createdAt: page[i]?.createdAtText, id: node.id }),
        })),
        hasNextPage,
        totalCount: totalRows[0]?.value ?? 0,
      };
    });
  }

  async search(term: string, limit: number): Promise<AdminUserRecord[]> {
    return withAdmin(this.db, mkAdminCtx('service:admin-user'), async (tx) => {
      const condition = this.searchCondition(tx, term);
      if (!condition) return [];
      const rows = await tx
        .select(this.baseColumns)
        .from(usersLive)
        .leftJoin(userProfilesLive, eq(userProfilesLive.userId, usersLive.id))
        .where(condition)
        .orderBy(asc(usersLive.username))
        .limit(limit);
      return this.hydrate(tx, rows);
    });
  }

  async findDetail(userId: string): Promise<AdminUserDetailRecord | null> {
    return withAdmin(this.db, mkAdminCtx('service:admin-user'), async (tx) => {
      const [row] = await tx
        .select({
          ...this.baseColumns,
          gender: userProfilesLive.gender,
          dateOfBirth: userProfilesLive.dateOfBirth,
          nationality: userProfilesLive.nationality,
        })
        .from(usersLive)
        .leftJoin(userProfilesLive, eq(userProfilesLive.userId, usersLive.id))
        .where(eq(usersLive.id, userId))
        .limit(1);
      if (!row) return null;

      const { gender, dateOfBirth, nationality, ...base } = row;
      const [user] = await this.hydrate(tx, [base]);

      const [resellerMemberships, platformMemberships, identifiers, documents, addresses] =
        await Promise.all([
          tx
            .select({
              id: resellerMembershipsLive.id,
              resellerId: resellerMembershipsLive.resellerId,
              resellerName: resellersLive.name,
              roleName: rolesLive.name,
              isActive: resellerMembershipsLive.isActive,
              joinedAt: resellerMembershipsLive.createdAt,
            })
            .from(resellerMembershipsLive)
            .innerJoin(resellersLive, eq(resellersLive.id, resellerMembershipsLive.resellerId))
            .leftJoin(rolesLive, eq(rolesLive.id, resellerMembershipsLive.roleId))
            .where(eq(resellerMembershipsLive.userId, userId)),
          tx
            .select({
              id: platformMembershipsLive.id,
              roleName: rolesLive.name,
              isActive: platformMembershipsLive.isActive,
              joinedAt: platformMembershipsLive.createdAt,
            })
            .from(platformMembershipsLive)
            .leftJoin(rolesLive, eq(rolesLive.id, platformMembershipsLive.roleId))
            .where(eq(platformMembershipsLive.userId, userId))
            .limit(1),
          tx
            .select({
              id: userIdentifiersLive.id,
              type: userIdentifiersLive.type,
              valueMasked: userIdentifiersLive.valueMasked,
              valuePlain: userIdentifiersLive.valuePlain,
              isVerified: userIdentifiersLive.isVerified,
              issuingAuthority: userIdentifiersLive.issuingAuthority,
            })
            .from(userIdentifiersLive)
            .where(eq(userIdentifiersLive.userId, userId))
            .orderBy(asc(userIdentifiersLive.type)),
          tx
            .select({
              id: userDocumentsLive.id,
              type: userDocumentsLive.type,
              description: userDocumentsLive.description,
              referenceNumber: userDocumentsLive.referenceNumber,
              isVerified: userDocumentsLive.isVerified,
              rejectionReason: userDocumentsLive.rejectionReason,
              uploadedAt: userDocumentsLive.createdAt,
            })
            .from(userDocumentsLive)
            .where(eq(userDocumentsLive.userId, userId))
            .orderBy(desc(userDocumentsLive.createdAt)),
          tx
            .select({
              id: userAddressesLive.id,
              type: userAddressesLive.type,
              line1: userAddressesLive.line1,
              line2: userAddressesLive.line2,
              line3: userAddressesLive.line3,
              city: userAddressesLive.city,
              district: userAddressesLive.district,
              state: userAddressesLive.state,
              country: userAddressesLive.country,
              postalCode: userAddressesLive.postalCode,
            })
            .from(userAddressesLive)
            .where(eq(userAddressesLive.userId, userId))
            .orderBy(asc(userAddressesLive.type)),
        ]);

      const documentFiles = await loadUserDocumentFiles(
        tx,
        documents.map((document) => document.id),
      );

      return {
        ...user,
        profile: user.profile ? { ...user.profile, gender, dateOfBirth, nationality } : null,
        resellerMemberships,
        platformMembership: platformMemberships[0] ?? null,
        identifiers: identifiers.map(
          ({ valueMasked, valuePlain, ...rest }): AdminUserIdentifierRecord => ({
            ...rest,
            displayValue: identifierDisplayValue(rest.type, valueMasked, valuePlain),
          }),
        ),
        documents: documents.map((document) => ({
          ...document,
          files: documentFiles.get(document.id) ?? [],
        })),
        addresses,
      };
    });
  }

  async findDocumentFile(fileId: string): Promise<FileRecord | null> {
    return withAdmin(this.db, mkAdminCtx('service:admin-user'), async (tx) => {
      const [row] = await tx
        .select(fileLiveColumns)
        .from(userDocumentFilesLive)
        .innerJoin(filesLive, eq(filesLive.id, userDocumentFilesLive.fileId))
        .where(and(eq(userDocumentFilesLive.fileId, fileId), eq(filesLive.status, 'READY')));
      return (row as FileRecord | undefined) ?? null;
    });
  }

  async statistics(now: Date): Promise<AdminUserStatisticsRecord> {
    return withAdmin(this.db, mkAdminCtx('service:admin-user'), async (tx) => {
      const monthAgo = new Date(now.getTime() - 30 * DAY_MS);
      const weekAgo = new Date(now.getTime() - 7 * DAY_MS);
      const multiInstitute = tx
        .select({ userId: membershipsLive.userId })
        .from(membershipsLive)
        .groupBy(membershipsLive.userId)
        .having(sql`count(DISTINCT ${membershipsLive.tenantId}) > 1`)
        .as('multi_institute');

      const [[totals], [active], [multi]] = await Promise.all([
        tx
          .select({
            total: count(),
            newThisWeek:
              sql<number>`count(*) FILTER (WHERE ${usersLive.createdAt} >= ${weekAgo} AND ${usersLive.createdAt} <= ${now})`.mapWith(
                Number,
              ),
          })
          .from(usersLive),
        tx
          .select({ value: countDistinct(authEvents.userId) })
          .from(authEvents)
          .innerJoin(usersLive, eq(usersLive.id, authEvents.userId))
          .where(
            and(
              inArray(authEvents.eventType, ACTIVITY_EVENT_TYPES),
              gte(authEvents.createdAt, monthAgo),
              lte(authEvents.createdAt, now),
            ),
          ),
        tx.select({ value: count() }).from(multiInstitute),
      ]);

      return {
        totalUsers: totals?.total ?? 0,
        newThisWeek: totals?.newThisWeek ?? 0,
        activeThisMonth: active?.value ?? 0,
        multiInstituteUsers: multi?.value ?? 0,
      };
    });
  }
}
