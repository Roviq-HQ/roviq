import { sql } from 'drizzle-orm';
import {
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  time,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { i18nText, sameTenantForeignKey, tenantColumns } from '../common/columns';
import { batchStatus, genderRestriction } from '../common/enums';
import { tenantPolicies } from '../common/rls-policies';
import { academicYears } from './academic-years';
import { institutes } from './institutes';
import { standards } from './standards';

/** Stream assignment for senior secondary sections (e.g., Science PCM, Commerce) */
export type StreamConfig = {
  /** Human-readable stream name (e.g., "Science PCM", "Commerce") */
  name: string;
  /** Machine-readable code (e.g., "sci_pcm", "commerce") */
  code: string;
};

export const sections = pgTable(
  'sections',
  {
    id: uuid().default(sql`uuidv7()`).primaryKey(),
    standardId: uuid('standard_id').notNull(),
    academicYearId: uuid('academic_year_id').notNull(),
    name: i18nText('name').notNull(),
    displayLabel: text('display_label'),
    /** Stream for senior secondary (11-12). JSONB because NEP 2020 allows cross-stream combos */
    stream: jsonb().$type<StreamConfig>(),
    /** Language of instruction: english, hindi, bilingual, urdu. Per-section, not per-institute */
    mediumOfInstruction: text('medium_of_instruction'),
    shift: text(),
    // Same-institute key with ON DELETE SET NULL (class_teacher_id): custom SQL, Drizzle cannot declare it.
    classTeacherId: uuid('class_teacher_id'),
    room: text(),
    capacity: integer().default(40),
    currentStrength: integer('current_strength').default(0).notNull(),
    genderRestriction: genderRestriction('gender_restriction').default('CO_ED').notNull(),
    displayOrder: integer('display_order').default(0).notNull(),
    // Coaching batch fields
    startTime: time('start_time'),
    endTime: time('end_time'),
    batchStatus: batchStatus('batch_status'),
    ...tenantColumns,
  },
  (table) => [
    // The target of every same-institute foreign key to this table.
    uniqueIndex('sections_id_tenant_key').on(table.id, table.tenantId),
    sameTenantForeignKey(
      'sections_standard_id_tenant_fkey',
      [table.standardId, table.tenantId],
      [standards.id, standards.tenantId],
    )
      .onDelete('cascade')
      .onUpdate('cascade'),
    sameTenantForeignKey(
      'sections_academic_year_id_tenant_fkey',
      [table.academicYearId, table.tenantId],
      [academicYears.id, academicYears.tenantId],
    )
      .onDelete('cascade')
      .onUpdate('cascade'),
    index('idx_sections_name_gin').using('gin', table.name),
    index('idx_sections_name_trgm').using(
      'gin',
      sql`i18n_text_to_string(${table.name}) gin_trgm_ops`,
    ),
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [institutes.id],
    })
      .onDelete('cascade')
      .onUpdate('cascade'),
    uniqueIndex('sections_standard_name_key')
      .on(table.standardId, table.name)
      .where(sql`${table.deletedAt} IS NULL`),
    index('sections_tenant_id_idx').on(table.tenantId),
    index('sections_standard_id_idx').on(table.standardId),
    index('sections_academic_year_id_idx').on(table.academicYearId),
    ...tenantPolicies('sections'),
  ],
);
