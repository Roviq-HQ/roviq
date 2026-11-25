import { Inject, Injectable } from '@nestjs/common';
import {
  MESSAGE_TEMPLATE_CATEGORY_VALUES,
  type MessageTemplateCategory,
} from '@roviq/common-types';
import {
  DRIZZLE_DB,
  type DrizzleDB,
  messagingSendersLive,
  messagingTemplates,
  mkAdminCtx,
  SYSTEM_USER_ID,
  withAdmin,
} from '@roviq/database';
import { and, eq, inArray, isNotNull, notInArray, sql } from 'drizzle-orm';
import {
  type AccountTemplateProblems,
  type MessagingTemplateRecord,
  MessagingTemplateRepository,
  PENDING_LONG_HOURS,
  type TemplateEventChange,
} from './messaging-template.repository';

const ORIGIN = 'repository:messaging-template';
const t = messagingTemplates;

const columns = {
  providerAccountId: t.providerAccountId,
  name: t.name,
  language: t.language,
  declaredCategory: t.declaredCategory,
  approvedCategory: t.approvedCategory,
  contentHash: t.contentHash,
  providerTemplateId: t.providerTemplateId,
  status: t.status,
  rejectedReason: t.rejectedReason,
  quality: t.quality,
  suggestedCategory: t.suggestedCategory,
  outOfStep: t.outOfStep,
};

type Row = Omit<MessagingTemplateRecord, 'declaredCategory' | 'approvedCategory'> & {
  declaredCategory: string;
  approvedCategory: string | null;
};

const categoryOf = (value: string | null): MessageTemplateCategory | null =>
  MESSAGE_TEMPLATE_CATEGORY_VALUES.find((c) => c === value) ?? null;

function recordOf(row: Row): MessagingTemplateRecord {
  return {
    ...row,
    // Only the sync writes it, from a definition; an unknown value is the dearer class.
    declaredCategory: categoryOf(row.declaredCategory) ?? 'MARKETING',
    approvedCategory: categoryOf(row.approvedCategory),
  };
}

@Injectable()
export class MessagingTemplateDrizzleRepository extends MessagingTemplateRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDB) {
    super();
  }

  async listForAccount(providerAccountId: string): Promise<MessagingTemplateRecord[]> {
    const rows = await withAdmin(this.db, mkAdminCtx(ORIGIN), (tx) =>
      tx
        .select(columns)
        .from(t)
        .where(and(eq(t.providerAccountId, providerAccountId), eq(t.retired, false))),
    );
    return rows.map(recordOf);
  }

  async upsert(rows: readonly MessagingTemplateRecord[]): Promise<void> {
    if (rows.length === 0) return;
    await withAdmin(this.db, mkAdminCtx(ORIGIN), (tx) =>
      tx
        .insert(t)
        .values(
          rows.map((r) => ({
            ...r,
            retired: false,
            createdBy: SYSTEM_USER_ID,
            updatedBy: SYSTEM_USER_ID,
          })),
        )
        .onConflictDoUpdate({
          target: [t.providerAccountId, t.name, t.language],
          set: {
            declaredCategory: sql`excluded.declared_category`,
            approvedCategory: sql`excluded.approved_category`,
            contentHash: sql`excluded.content_hash`,
            providerTemplateId: sql`excluded.provider_template_id`,
            status: sql`excluded.status`,
            rejectedReason: sql`excluded.rejected_reason`,
            quality: sql`excluded.quality`,
            outOfStep: sql`excluded.out_of_step`,
            retired: false,
            updatedBy: SYSTEM_USER_ID,
          },
        }),
    );
  }

  async retireExcept(providerAccountId: string, names: readonly string[]): Promise<void> {
    // An empty registry would retire every row: never the intent.
    if (names.length === 0) return;
    await withAdmin(this.db, mkAdminCtx(ORIGIN), (tx) =>
      tx
        .update(t)
        .set({ retired: true, updatedBy: SYSTEM_USER_ID })
        .where(
          and(
            eq(t.providerAccountId, providerAccountId),
            eq(t.retired, false),
            notInArray(t.name, [...names]),
          ),
        ),
    );
  }

  async applyEvent(
    providerAccountId: string,
    name: string,
    language: string,
    change: TemplateEventChange,
  ): Promise<boolean> {
    if (Object.keys(change).length === 0) return false;
    // An approval that names no category keeps a known one, else takes the declared one; a
    // category change the provider made arrives as its own event.
    const approvedCategory =
      change.status === 'APPROVED' && change.approvedCategory === undefined
        ? sql`coalesce(${t.approvedCategory}, ${t.declaredCategory})`
        : change.approvedCategory;
    const updated = await withAdmin(this.db, mkAdminCtx(ORIGIN), (tx) =>
      tx
        .update(t)
        .set({
          ...change,
          ...(approvedCategory === undefined ? {} : { approvedCategory }),
          updatedBy: SYSTEM_USER_ID,
        })
        .where(
          and(
            eq(t.providerAccountId, providerAccountId),
            eq(t.name, name),
            eq(t.language, language),
          ),
        )
        .returning({ name: t.name }),
    );
    return updated.length > 0;
  }

  async find(
    providerAccountId: string,
    name: string,
    language: string,
  ): Promise<MessagingTemplateRecord | null> {
    const [row] = await withAdmin(this.db, mkAdminCtx(ORIGIN), (tx) =>
      tx
        .select(columns)
        .from(t)
        .where(
          and(
            eq(t.providerAccountId, providerAccountId),
            eq(t.name, name),
            eq(t.language, language),
          ),
        )
        .limit(1),
    );
    return row ? recordOf(row) : null;
  }

  async countProblems(): Promise<AccountTemplateProblems[]> {
    return withAdmin(this.db, mkAdminCtx(ORIGIN), (tx) =>
      tx
        .select({
          providerAccountId: t.providerAccountId,
          REJECTED: sql<number>`count(*) FILTER (WHERE ${t.status} = 'REJECTED')::int`,
          PAUSED: sql<number>`count(*) FILTER (WHERE ${t.status} = 'PAUSED')::int`,
          DISABLED: sql<number>`count(*) FILTER (WHERE ${t.status} = 'DISABLED')::int`,
          CATEGORY_CHANGED: sql<number>`count(*) FILTER (WHERE ${t.approvedCategory} IS NOT NULL AND ${t.approvedCategory} <> ${t.declaredCategory})::int`,
          OUT_OF_STEP: sql<number>`count(*) FILTER (WHERE ${t.outOfStep})::int`,
          PENDING_LONG: sql<number>`count(*) FILTER (WHERE ${t.status} = 'PENDING' AND ${t.createdAt} < now() - make_interval(hours => ${PENDING_LONG_HOURS}))::int`,
        })
        .from(t)
        .where(
          and(
            eq(t.retired, false),
            // A deleted sender's account is nobody's problem any more.
            inArray(
              t.providerAccountId,
              tx
                .select({ account: messagingSendersLive.providerAccountId })
                .from(messagingSendersLive)
                .where(isNotNull(messagingSendersLive.providerAccountId)),
            ),
          ),
        )
        .groupBy(t.providerAccountId),
    );
  }
}
