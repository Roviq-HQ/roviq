import { AcademicStatus, InstituteType, PromotionStatus } from '@roviq/common-types';
import { type DrizzleDB, SYSTEM_USER_ID } from '@roviq/database';
import { sql } from 'drizzle-orm';

const CONTINUING_STATUSES = [
  AcademicStatus.ENROLLED,
  AcademicStatus.PROMOTED,
  AcademicStatus.DETAINED,
  AcademicStatus.RE_ENROLLED,
] as const;

export interface YearRolloverCounts {
  /** Placed (or would be) in a higher level than last year. */
  movingUp: number;
  /** Placed (or would be) at the same level as last year. */
  staying: number;
  /** Top level under the next-level rule: no row in the new year. */
  completing: number;
  /** Recorded as GRADUATED or TRANSFERRED: no row in the new year. */
  notCarried: number;
  /** Target level has no live standard or section in the new year. */
  noClassInNewYear: number;
  /** Already had a row (live or deleted) in the new year. */
  alreadyPlaced: number;
}

export interface YearRolloverParams {
  tenantId: string;
  previousYearId: string;
  academicYearId: string;
  /** `false` counts what the rollover would do and writes nothing. */
  write: boolean;
}

type CountRow = { [K in keyof YearRolloverCounts]: number } & Record<string, unknown>;

/**
 * Year-end promotion rule, shared by the `ACADEMIC_YEAR.activated` consumer and the activation
 * preview. Must run inside `withTenant`: every read goes through RLS-filtered `*_live` views.
 * Standards belong to one year, so the target level (a `numeric_order`) is matched to the new
 * year's standard with that order; the student keeps a section of the same English name there,
 * else goes into its first section.
 */
export async function rollOverStudents(
  tx: DrizzleDB,
  { tenantId, previousYearId, academicYearId, write }: YearRolloverParams,
): Promise<YearRolloverCounts> {
  const statuses = sql.join(
    CONTINUING_STATUSES.map((s) => sql`${s}`),
    sql`, `,
  );
  const inserted = write
    ? sql`
        INSERT INTO student_academics
          (tenant_id, student_profile_id, academic_year_id, standard_id, section_id,
           created_by, updated_by)
        SELECT ${tenantId}::uuid, p.student_profile_id, ${academicYearId}::uuid, p.standard_id,
               p.section_id, ${SYSTEM_USER_ID}::uuid, ${SYSTEM_USER_ID}::uuid
        FROM placeable p
        ON CONFLICT (student_profile_id, academic_year_id) WHERE deleted_at IS NULL DO NOTHING
        RETURNING student_profile_id`
    : sql`SELECT student_profile_id FROM placeable`;

  const result = await tx.execute<CountRow>(sql`
    WITH classified AS (
      SELECT sa.student_profile_id,
             cs.numeric_order AS current_order,
             COALESCE(sa.promotion_status IN (${PromotionStatus.GRADUATED},
               ${PromotionStatus.TRANSFERRED}), false) AS not_carried,
             -- A deleted row counts too: redelivery must not re-place a student removed since.
             EXISTS (
               SELECT 1 FROM student_academics done
               WHERE done.student_profile_id = sa.student_profile_id
                 AND done.academic_year_id = ${academicYearId}::uuid
             ) AS already_placed,
             CASE
               WHEN sa.promotion_status = ${PromotionStatus.PROMOTED}
                    AND sa.promoted_to_standard_id IS NOT NULL THEN 'explicit'
               WHEN sa.promotion_status = ${PromotionStatus.DETAINED} THEN 'same'
               WHEN sa.promotion_status IS DISTINCT FROM ${PromotionStatus.PROMOTED}
                    AND (SELECT i.type FROM institutes_live i WHERE i.id = ${tenantId}::uuid)
                        = ${InstituteType.COACHING} THEN 'same'
               ELSE 'next'
             END AS rule,
             pts.numeric_order AS explicit_order,
             lower(btrim(psec.name->>'en')) AS section_key,
             -- Both years: an institute that adds a class this year has no higher level last year.
             (SELECT min(hs.numeric_order) FROM standards_live hs
               WHERE hs.academic_year_id IN (${previousYearId}::uuid, ${academicYearId}::uuid)
                 AND hs.numeric_order > cs.numeric_order) AS next_order
      FROM student_academics_live sa
      JOIN student_profiles_live sp ON sp.id = sa.student_profile_id
      JOIN standards_live cs ON cs.id = sa.standard_id
      LEFT JOIN standards_live pts ON pts.id = sa.promoted_to_standard_id
      LEFT JOIN sections_live psec ON psec.id = sa.section_id
      WHERE sa.academic_year_id = ${previousYearId}::uuid
        AND sp.academic_status IN (${statuses})
        AND EXISTS (SELECT 1 FROM academic_years_live ay WHERE ay.id = ${academicYearId}::uuid)
    ),
    targeted AS (
      SELECT c.*,
             CASE c.rule
               WHEN 'explicit' THEN c.explicit_order
               WHEN 'same' THEN c.current_order
               ELSE c.next_order
             END AS target_order
      FROM classified c
      WHERE NOT c.not_carried AND NOT c.already_placed
    ),
    matched AS (
      SELECT t.student_profile_id, t.current_order, t.target_order,
             ns.id AS standard_id, sec.id AS section_id
      FROM targeted t
      LEFT JOIN standards_live ns
        ON ns.academic_year_id = ${academicYearId}::uuid AND ns.numeric_order = t.target_order
      LEFT JOIN LATERAL (
        SELECT s.id FROM sections_live s
        WHERE s.standard_id = ns.id AND s.academic_year_id = ${academicYearId}::uuid
        ORDER BY COALESCE(lower(btrim(s.name->>'en')) = t.section_key, false) DESC,
                 s.display_order, s.id
        LIMIT 1
      ) sec ON true
      WHERE NOT (t.rule = 'next' AND t.target_order IS NULL)
    ),
    placeable AS (
      SELECT * FROM matched WHERE section_id IS NOT NULL
    ),
    placed_ids AS (${inserted}),
    placed AS (
      SELECT p.* FROM placeable p
      WHERE p.student_profile_id IN (SELECT student_profile_id FROM placed_ids)
    )
    SELECT
      (SELECT count(*) FROM placed WHERE target_order > current_order)::int AS "movingUp",
      (SELECT count(*) FROM placed WHERE target_order <= current_order)::int AS "staying",
      (SELECT count(*) FROM targeted WHERE rule = 'next' AND target_order IS NULL)::int
        AS "completing",
      (SELECT count(*) FROM classified WHERE not_carried)::int AS "notCarried",
      (SELECT count(*) FROM matched WHERE section_id IS NULL)::int AS "noClassInNewYear",
      ((SELECT count(*) FROM classified WHERE already_placed AND NOT not_carried)
        + (SELECT count(*) FROM placeable) - (SELECT count(*) FROM placed))::int AS "alreadyPlaced"
  `);
  const [row] = result.rows;
  return {
    movingUp: row.movingUp,
    staying: row.staying,
    completing: row.completing,
    notCarried: row.notCarried,
    noClassInNewYear: row.noClassInNewYear,
    alreadyPlaced: row.alreadyPlaced,
  };
}
