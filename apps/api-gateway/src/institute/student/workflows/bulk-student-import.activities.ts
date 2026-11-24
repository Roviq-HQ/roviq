/**
 * Activities for BulkStudentImportWorkflow (ROV-155, PRD §7.1).
 *
 * Each activity is idempotent where possible.
 * DrizzleDB + NATS client injected via closure at worker startup.
 */
import { Logger } from '@nestjs/common';
import {
  AcademicStatus,
  AdmissionType,
  Gender,
  isStudentImportField,
  SocialCategory,
  studentImportFieldForHeader,
} from '@roviq/common-types';
import { type DrizzleDB, mkInstituteCtx, studentProfilesLive, withTenant } from '@roviq/database';
import { EVENT_PATTERNS, type EventPattern } from '@roviq/nats-jetstream';
import { eq } from 'drizzle-orm';
import Papa from 'papaparse';
import type { IdentityService } from '../../../auth/identity.service';
import { admitStudent, findStudentRoleId } from '../repositories/admit-student';
import type {
  BulkStudentImportActivities,
  ImportFileStore,
  RowError,
  ValidatedRow,
} from './bulk-student-import.types';

const logger = new Logger('BulkStudentImportActivities');

export const ROW_INSERT_FAILED =
  'This student could not be created because of a system error. Import the row again or add the student by hand.';

// ── Validation helpers ────────────────────────────────────

/** Valid Indian mobile: exactly 10 digits starting with 6-9 */
const INDIAN_MOBILE_REGEX = /^[6-9]\d{9}$/;

/** Accepted date formats: DD/MM/YYYY, YYYY-MM-DD, DD-MM-YYYY */
function parseDate(value: string): string | null {
  const trimmed = value.trim();
  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return calendarDate(iso[1], iso[2], iso[3]);
  const dmy = trimmed.match(/^(\d{2})[/-](\d{2})[/-](\d{4})$/);
  if (dmy) return calendarDate(dmy[3], dmy[2], dmy[1]);
  return null;
}

// `new Date('2014-02-31')` rolls over to 3 March instead of failing, so the parts must survive the round trip.
function calendarDate(year: string, month: string, day: string): string | null {
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  const valid =
    date.getUTCFullYear() === Number(year) &&
    date.getUTCMonth() === Number(month) - 1 &&
    date.getUTCDate() === Number(day);
  return valid ? `${year}-${month}-${day}` : null;
}

const VALID_GENDERS = new Set(['MALE', 'FEMALE', 'OTHER']);
const VALID_SOCIAL_CATEGORIES = new Set(Object.values(SocialCategory));
const VALID_ADMISSION_TYPES = new Set(Object.values(AdmissionType));
const VALID_BLOOD_GROUPS = new Set(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']);

// ── Per-field validation helpers ─────────────────────────

/** Validate first_name (required). */
function validateFirstName(
  mapped: Record<string, string>,
  rowNumber: number,
): { value: string | undefined; error: RowError | null } {
  const firstName = mapped.first_name?.trim();
  if (!firstName) {
    return {
      value: undefined,
      error: {
        rowNumber,
        field: 'first_name',
        reason: 'First name is required',
        originalValue: mapped.first_name,
      },
    };
  }
  return { value: firstName, error: null };
}

/** Validate date_of_birth (required, must parse). */
function validateDateOfBirth(
  mapped: Record<string, string>,
  rowNumber: number,
): { value: string | null; error: RowError | null } {
  const rawDob = mapped.date_of_birth?.trim();
  if (!rawDob) {
    return {
      value: null,
      error: {
        rowNumber,
        field: 'date_of_birth',
        reason: 'Date of birth is required',
        originalValue: rawDob,
      },
    };
  }
  const dateOfBirth = parseDate(rawDob);
  if (!dateOfBirth) {
    return {
      value: null,
      error: {
        rowNumber,
        field: 'date_of_birth',
        reason: 'Invalid date format. Expected DD/MM/YYYY or YYYY-MM-DD',
        originalValue: rawDob,
      },
    };
  }
  return { value: dateOfBirth, error: null };
}

/** Validate gender (required, must be in allowed set). */
function validateGender(
  mapped: Record<string, string>,
  rowNumber: number,
): { value: Gender | undefined; error: RowError | null } {
  const rawGender = mapped.gender?.trim().toUpperCase();
  if (!rawGender) {
    return {
      value: undefined,
      error: {
        rowNumber,
        field: 'gender',
        reason: 'Gender is required (MALE/FEMALE/OTHER)',
        originalValue: mapped.gender,
      },
    };
  }
  if (!VALID_GENDERS.has(rawGender)) {
    return {
      value: undefined,
      error: {
        rowNumber,
        field: 'gender',
        reason: `Invalid gender: "${rawGender}". Must be MALE, FEMALE, or OTHER`,
        originalValue: mapped.gender,
      },
    };
  }
  return { value: rawGender as Gender, error: null };
}

/** Validate social_category (optional, enum check). */
function validateSocialCategory(
  mapped: Record<string, string>,
  rowNumber: number,
): { value: SocialCategory | undefined; error: RowError | null } {
  const raw = mapped.social_category?.trim().toUpperCase();
  if (raw && !VALID_SOCIAL_CATEGORIES.has(raw as SocialCategory)) {
    return {
      value: undefined,
      error: {
        rowNumber,
        field: 'social_category',
        reason: `Invalid social category: "${raw}". Must be GENERAL, SC, ST, OBC, or EWS`,
        originalValue: mapped.social_category,
      },
    };
  }
  return { value: (raw as SocialCategory) || undefined, error: null };
}

/** Normalize and validate phone (optional, Indian mobile). */
function validatePhone(
  mapped: Record<string, string>,
  rowNumber: number,
): { value: string | undefined; error: RowError | null } {
  const rawPhone = mapped.phone?.trim().replace(/[\s-]/g, '');
  // Strip +91 or 91 prefix only when input is longer than 10 digits (country code present)
  const phone = rawPhone && rawPhone.length > 10 ? rawPhone.replace(/^\+?91/, '') : rawPhone;
  if (phone && !INDIAN_MOBILE_REGEX.test(phone)) {
    return {
      value: undefined,
      error: {
        rowNumber,
        field: 'phone',
        reason: 'Invalid Indian mobile number. Must be 10 digits starting with 6-9',
        originalValue: mapped.phone,
      },
    };
  }
  return { value: phone || undefined, error: null };
}

/** Validate admission_type (optional, enum check). */
function validateAdmissionType(
  mapped: Record<string, string>,
  rowNumber: number,
): { value: AdmissionType | undefined; error: RowError | null } {
  const raw = mapped.admission_type?.trim().toUpperCase();
  if (raw && !VALID_ADMISSION_TYPES.has(raw as AdmissionType)) {
    return {
      value: undefined,
      error: {
        rowNumber,
        field: 'admission_type',
        reason: `Invalid admission type: "${raw}"`,
        originalValue: mapped.admission_type,
      },
    };
  }
  return { value: (raw as AdmissionType) || undefined, error: null };
}

/** Validate blood_group (optional, enum check). */
function validateBloodGroup(
  mapped: Record<string, string>,
  rowNumber: number,
): { value: string | undefined; error: RowError | null } {
  const raw = mapped.blood_group?.trim().toUpperCase();
  if (raw && !VALID_BLOOD_GROUPS.has(raw)) {
    return {
      value: undefined,
      error: {
        rowNumber,
        field: 'blood_group',
        reason: `Invalid blood group: "${raw}". Must be A+/A-/B+/B-/AB+/AB-/O+/O-`,
        originalValue: mapped.blood_group,
      },
    };
  }
  return { value: raw || undefined, error: null };
}

// ── CSV parsing ───────────────────────────────────────────

/**
 * Apply field mapping: rename CSV columns → internal field names.
 * Unmapped columns whose names match known fields are kept as-is.
 */
function applyFieldMapping(
  raw: Record<string, string>,
  fieldMapping: Record<string, string>,
): Record<string, string> {
  const mapped: Record<string, string> = {};
  for (const [csvCol, value] of Object.entries(raw)) {
    const targetField = fieldMapping[csvCol];
    if (targetField && isStudentImportField(targetField)) {
      mapped[targetField] = value;
    } else {
      const named = studentImportFieldForHeader(csvCol);
      if (named) mapped[named] = value;
    }
  }
  return mapped;
}

/**
 * Detect encoding by checking for UTF-8 BOM and trying to decode.
 * Falls back to ISO-8859-1 if UTF-8 decoding produces replacement chars.
 */
function decodeBuffer(bytes: Uint8Array): string {
  // Check for UTF-8 BOM (EF BB BF)
  const hasBom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  const start = hasBom ? 3 : 0;

  // Try UTF-8 first
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(start));

  // If it contains replacement characters, try ISO-8859-1
  if (utf8.includes('\uFFFD')) {
    return new TextDecoder('iso-8859-1').decode(bytes.subarray(start));
  }

  return utf8;
}

/**
 * Validate a single mapped row and return a ValidatedRow or errors.
 */
function validateRow(
  mapped: Record<string, string>,
  rowNumber: number,
): { row: ValidatedRow | null; errors: RowError[] } {
  const errors: RowError[] = [];

  // Run each field validator and collect errors + cleaned values
  const firstName = validateFirstName(mapped, rowNumber);
  const dateOfBirth = validateDateOfBirth(mapped, rowNumber);
  const gender = validateGender(mapped, rowNumber);
  const socialCategory = validateSocialCategory(mapped, rowNumber);
  const phone = validatePhone(mapped, rowNumber);
  const admissionType = validateAdmissionType(mapped, rowNumber);
  const bloodGroup = validateBloodGroup(mapped, rowNumber);

  const validations = [
    firstName,
    dateOfBirth,
    gender,
    socialCategory,
    phone,
    admissionType,
    bloodGroup,
  ];
  for (const v of validations) {
    if (v.error) errors.push(v.error);
  }

  if (errors.length > 0) {
    return { row: null, errors };
  }

  return {
    row: {
      rowNumber,
      firstName: firstName.value ?? '',
      lastName: mapped.last_name?.trim() || undefined,
      dateOfBirth: dateOfBirth.value ?? '',
      gender: gender.value as Gender,
      fatherName: mapped.father_name?.trim() || undefined,
      motherName: mapped.mother_name?.trim() || undefined,
      phone: phone.value,
      email: mapped.email?.trim() || undefined,
      socialCategory: socialCategory.value,
      admissionType: admissionType.value,
      admissionNumber: mapped.admission_number?.trim() || undefined,
      standardId: mapped.standard_id?.trim() || undefined,
      sectionId: mapped.section_id?.trim() || undefined,
      religion: mapped.religion?.trim() || undefined,
      bloodGroup: bloodGroup.value,
      previousSchoolName: mapped.previous_school_name?.trim() || undefined,
    },
    errors: [],
  };
}

// ── Activity factory ──────────────────────────────────────

/**
 * NATS client shape — minimal interface for event emission.
 * Using a narrow type instead of ClientProxy to allow null when NATS is not yet wired.
 */
interface NatsEmitter {
  emit(
    pattern: string,
    data: unknown,
  ): { subscribe: (opts: { error?: (err: unknown) => void }) => void };
}

// ── Extracted DB helpers for insertBatch ──────────────────

/** Check if admission number already exists for this tenant. */
async function admissionNumberExists(
  db: DrizzleDB,
  tenantId: string,
  admNo: string,
): Promise<boolean> {
  const existing = await withTenant(
    db,
    mkInstituteCtx(tenantId, 'workflow:bulk-student-import.activities'),
    async (tx) => {
      return tx
        .select({ id: studentProfilesLive.id })
        .from(studentProfilesLive)
        .where(eq(studentProfilesLive.admissionNumber, admNo))
        .limit(1);
    },
  );
  return existing.length > 0;
}

/** Create a new user via IdentityService. Returns the new userId. */
async function createUser(
  identityService: IdentityService,
  row: ValidatedRow,
  tenantId: string,
  actorId: string,
): Promise<string> {
  const email = row.email ?? `student-${Date.now()}-${row.rowNumber}@roviq.placeholder`;
  const username = `student-${tenantId.slice(0, 8)}-${Date.now()}-${row.rowNumber}`;
  // Unverified contact data: siblings share a parent's number and each is still a new user.
  const phone = row.phone ? { countryCode: '+91', number: row.phone } : undefined;

  const { userId } = await identityService.createUser({ email, username, phone, actorId });
  return userId;
}

// ── Per-row insert helpers for insertBatch ───────────────

/** Params shared across all rows in a single batch insert call. */
interface InsertRowContext {
  db: DrizzleDB;
  identityService: IdentityService;
  tenantId: string;
  academicYearId: string;
  defaultStandardId: string;
  defaultSectionId: string;
  createdBy: string;
  emitEvent: (pattern: EventPattern, data: unknown) => void;
}

/** The institute-side rows of one row's student, in one transaction (ROV-275). */
function admitRow(ctx: InsertRowContext, row: ValidatedRow, userId: string) {
  return withTenant(
    ctx.db,
    mkInstituteCtx(ctx.tenantId, 'workflow:bulk-student-import.activities'),
    (tx) =>
      admitStudent(tx, {
        tenantId: ctx.tenantId,
        userId,
        actorId: ctx.createdBy,
        academicYearId: ctx.academicYearId,
        standardId: row.standardId ?? ctx.defaultStandardId,
        sectionId: row.sectionId ?? ctx.defaultSectionId,
        tenantProfile: {
          ...rowName(row),
          gender: row.gender,
          dateOfBirth: row.dateOfBirth,
          bloodGroup: row.bloodGroup ?? null,
          religion: row.religion ?? null,
        },
        profile: {
          admissionDate: new Date().toISOString().split('T')[0],
          admissionClass: null,
          admissionType: row.admissionType ?? AdmissionType.NEW,
          academicStatus: AcademicStatus.ENROLLED,
          socialCategory: row.socialCategory ?? SocialCategory.GENERAL,
          caste: null,
          isMinority: false,
          minorityType: null,
          isBpl: false,
          isCwsn: false,
          cwsnType: null,
          isRteAdmitted: false,
          rteCertificate: null,
          previousSchoolName: row.previousSchoolName ?? null,
          previousSchoolBoard: null,
          previousSchoolUdise: null,
          incomingTcNumber: null,
          incomingTcDate: null,
        },
        admissionNumber: row.admissionNumber ?? null,
        assignRollNumber: true,
      }),
  );
}

function rowName(row: ValidatedRow) {
  return {
    firstName: { en: row.firstName },
    lastName: row.lastName ? { en: row.lastName } : null,
  };
}

/** A row that failed must not leave the account it made behind (ROV-275). */
async function discardAccount(ctx: InsertRowContext, userId: string, rowNumber: number) {
  try {
    if (!(await ctx.identityService.discardNewUser(userId))) {
      logger.warn(`Row ${rowNumber}: kept account ${userId}: it is in use`);
    }
  } catch (error) {
    logger.error(`Row ${rowNumber}: could not remove account ${userId}`, error);
  }
}

/**
 * Process a single row for insertion. Returns 'created', 'skipped', or throws on failure.
 */
async function insertSingleRow(
  ctx: InsertRowContext,
  row: ValidatedRow,
): Promise<'created' | 'skipped'> {
  // Dedup by admission number
  if (
    row.admissionNumber &&
    (await admissionNumberExists(ctx.db, ctx.tenantId, row.admissionNumber))
  ) {
    logger.log(
      `Row ${row.rowNumber}: Skipping — admission number ${row.admissionNumber} already exists`,
    );
    return 'skipped';
  }

  // A typed number never identifies an existing account (SF-053): every row is a new user.
  const userId = await createUser(ctx.identityService, row, ctx.tenantId, ctx.createdBy);
  let admitted: Awaited<ReturnType<typeof admitRow>>;
  try {
    await ctx.identityService.ensureUserProfile(userId, rowName(row), ctx.createdBy);
    admitted = await admitRow(ctx, row, userId);
  } catch (error) {
    await discardAccount(ctx, userId, row.rowNumber);
    throw error;
  }
  if (admitted.kind !== 'ok') {
    await discardAccount(ctx, userId, row.rowNumber);
    throw new Error(`Student not admitted: ${admitted.kind}`);
  }

  logger.log(
    `Row ${row.rowNumber}: Created student "${row.firstName}" (admission: ${admitted.admissionNumber})`,
  );
  ctx.emitEvent(EVENT_PATTERNS.STUDENT.admitted, {
    tenantId: ctx.tenantId,
    userId,
    studentProfileId: admitted.studentProfileId,
    admissionNumber: admitted.admissionNumber,
    rowNumber: row.rowNumber,
  });
  return 'created';
}

// ── Activity factory ──────────────────────────────────────

/**
 * Create activity implementations bound to DrizzleDB + NATS client.
 * Called at Temporal worker startup — activities close over the connections.
 */
export function createBulkStudentImportActivities(
  db: DrizzleDB,
  natsClient: NatsEmitter | null,
  identityService: IdentityService | null,
  fileStore: ImportFileStore,
): BulkStudentImportActivities {
  /** Emit a NATS event if client is available. */
  function emitEvent(pattern: EventPattern, data: unknown): void {
    if (!natsClient) return;
    natsClient.emit(pattern, data).subscribe({
      error: (err) => logger.warn(`Failed to emit ${pattern}: ${err}`),
    });
  }

  return {
    async parseCsv(tenantId, fileId, fieldMapping) {
      logger.log(`Parsing CSV file ${fileId}`);

      const buffer = await fileStore.read(tenantId, fileId, 'BULK_IMPORT_CSV');
      const csvText = decodeBuffer(buffer);

      const parsed = Papa.parse<Record<string, string>>(csvText, {
        header: true,
        skipEmptyLines: true,
        transformHeader: (header) => header.trim(),
      });

      const totalRows = parsed.data.length;
      const validRows: ValidatedRow[] = [];
      const errors: RowError[] = [];

      for (const parseError of parsed.errors) {
        errors.push({
          rowNumber: (parseError.row ?? 0) + 1,
          field: '_parse',
          reason: parseError.message,
        });
      }

      for (let i = 0; i < parsed.data.length; i++) {
        const rawRow = parsed.data[i];
        const mapped = applyFieldMapping(rawRow, fieldMapping);
        const result = validateRow(mapped, i + 1);

        if (result.row) {
          validRows.push(result.row);
        }
        errors.push(...result.errors);
      }

      logger.log(
        `CSV parsed: ${totalRows} total, ${validRows.length} valid, ${errors.length} errors`,
      );
      return { validRows, errors, totalRows };
    },

    async insertBatch(
      tenantId,
      academicYearId,
      defaultStandardId,
      defaultSectionId,
      createdBy,
      rows,
    ) {
      logger.log(`Inserting batch of ${rows.length} rows for tenant ${tenantId}`);

      let created = 0;
      let skipped = 0;
      const errors: RowError[] = [];

      // Look up student role once per batch (same tenant)
      const studentRoleId = await withTenant(
        db,
        mkInstituteCtx(tenantId, 'workflow:bulk-student-import.activities'),
        (tx) => findStudentRoleId(tx, tenantId),
      );
      if (!studentRoleId) {
        for (const row of rows) {
          errors.push({
            rowNumber: row.rowNumber,
            field: '_system',
            reason: 'Student role not found for this institute',
          });
        }
        return { created, skipped, errors };
      }

      if (!identityService) {
        for (const row of rows) {
          errors.push({
            rowNumber: row.rowNumber,
            field: '_system',
            reason: 'Identity service is not wired in this worker — cannot create users',
          });
        }
        return { created, skipped, errors };
      }

      const ctx: InsertRowContext = {
        db,
        identityService,
        tenantId,
        academicYearId,
        defaultStandardId,
        defaultSectionId,
        createdBy,
        emitEvent,
      };

      for (const row of rows) {
        try {
          const result = await insertSingleRow(ctx, row);
          if (result === 'created') {
            created++;
          } else {
            skipped++;
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          logger.error(`Row ${row.rowNumber}: Insert failed — ${message}`);
          // The report goes to the institute: a driver error would show SQL and other rows' values.
          errors.push({
            rowNumber: row.rowNumber,
            field: '_system',
            reason: ROW_INSERT_FAILED,
          });
        }
      }

      logger.log(`Batch complete: ${created} created, ${skipped} skipped, ${errors.length} errors`);
      return { created, skipped, errors };
    },

    async generateReport({
      tenantId,
      reportFileId,
      createdBy,
      errors,
      totalRows,
      created,
      skipped: skippedCount,
    }) {
      logger.log(`Generating import report for tenant ${tenantId}`);

      // Build error CSV
      const csvRows = errors.map((e) => ({
        row_number: e.rowNumber,
        field: e.field,
        error: e.reason,
        original_value: e.originalValue ?? '',
      }));

      // Values come from the uploaded file: a cell starting with = + - @ must not run as a
      // formula when the report is opened in a spreadsheet.
      const csvContent = Papa.unparse(csvRows, { escapeFormulae: true });

      // Build full report content with summary header
      const reportContent = [
        `# Bulk Import Report`,
        `# Total rows: ${totalRows}`,
        `# Created: ${created}`,
        `# Skipped: ${skippedCount}`,
        `# Errors: ${errors.length}`,
        `#`,
        csvContent,
      ].join('\n');

      await fileStore.put({
        tenantId,
        fileId: reportFileId,
        purpose: 'BULK_IMPORT_REPORT',
        fileName: 'import-errors.csv',
        contentType: 'text/csv',
        body: Buffer.from(reportContent, 'utf8'),
        createdBy,
      });
      logger.log(
        `Report summary: ${totalRows} total, ${created} created, ${skippedCount} skipped, ${errors.length} errors`,
      );

      return { reportFileId };
    },
  };
}
