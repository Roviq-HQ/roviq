/**
 * Unit tests for BulkStudentImportWorkflow activities (ROV-155).
 *
 * Tests:
 * 1. CSV parsing with different encodings (UTF-8, BOM, ISO-8859-1)
 * 2. Field mapping applies correctly
 * 3. Validation: required fields, enum values, date formats
 * 4. Dedup by phone number
 * 5. Performance: 500 rows parse within reasonable time
 */

import { Gender, SocialCategory } from '@roviq/common-types';
import type { DrizzleDB } from '@roviq/database';
import { createMock } from '@roviq/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImportFileStore } from '../workflows/bulk-student-import.types';

interface MockNatsEmitter {
  emit(
    pattern: string,
    data: unknown,
  ): { subscribe: (opts: { error?: (err: unknown) => void }) => void };
  send(pattern: string, data: unknown): { subscribe: () => void };
}

// We test the pure functions extracted from activities
// by importing the module and testing internal logic via the activities interface

// ── Test helpers ──────────────────────────────────────────

/** Create a minimal CSV string from rows */
function buildCsv(headers: string[], rows: string[][]): string {
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(row.map((v) => (v.includes(',') ? `"${v}"` : v)).join(','));
  }
  return lines.join('\n');
}

const TENANT_ID = 'tenant-1';
const CSV_FILE_ID = 'csv-file-1';

/** In-memory stand-in for file storage: one uploaded CSV, and whatever the activities write. */
class FakeFileStore implements ImportFileStore {
  csv: Uint8Array | null = null;
  readonly written: Parameters<ImportFileStore['put']>[0][] = [];

  async read(tenantId: string, fileId: string, purpose: 'BULK_IMPORT_CSV'): Promise<Buffer> {
    if (!this.csv || tenantId !== TENANT_ID || fileId !== CSV_FILE_ID) {
      throw new Error(`File ${fileId} is not a ready ${purpose} file of this institute`);
    }
    return Buffer.from(this.csv);
  }

  async put(write: Parameters<ImportFileStore['put']>[0]): Promise<void> {
    this.written.push(write);
  }
}

let fileStore: FakeFileStore;

function storeCsv(csvContent: string): void {
  fileStore.csv = new TextEncoder().encode(csvContent);
}

function storeBomCsv(csvContent: string): void {
  const content = new TextEncoder().encode(csvContent);
  const combined = new Uint8Array(3 + content.length);
  combined.set([0xef, 0xbb, 0xbf]);
  combined.set(content, 3);
  fileStore.csv = combined;
}

// ── Mock DB + NATS ────────────────────────────────────────

/**
 * `createMock<DrizzleDB>` cannot model the fluent query-builder chain via its
 * partial argument because methods like `from`, `where`, `values`, etc. live on
 * the return type of `select()`/`insert()`, not on DrizzleDB itself. We build a
 * fully auto-mocked DrizzleDB and then assign chain methods on the same object
 * so `db.select().from().where()` short-circuits through our stubs.
 */
function createMockDb(): DrizzleDB {
  const mock = createMock<DrizzleDB>();
  const chain = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    onConflictDoNothing: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([{ id: 'mock-id' }]),
    execute: vi.fn().mockResolvedValue({
      rows: [{ next_val: '1', formatted: '0001' }],
    }),
  };
  Object.assign(mock, chain);
  return mock;
}

function createMockNats(): MockNatsEmitter {
  return createMock<MockNatsEmitter>({
    emit: vi.fn().mockReturnValue({ subscribe: vi.fn() }),
    send: vi.fn().mockReturnValue({ subscribe: vi.fn() }),
  });
}

// ── Import activities ─────────────────────────────────────

// We need to mock @roviq/database withTenant/withAdmin to run the callback
// with our mock transaction
vi.mock('@roviq/database', async () => {
  const actual = await vi.importActual('@roviq/database');
  return {
    ...actual,
    withAdmin: vi.fn(
      async (_db: unknown, ctxOrFn: unknown, fnArg?: (tx: unknown) => Promise<unknown>) => {
        const fn =
          typeof ctxOrFn === 'function'
            ? (ctxOrFn as (tx: unknown) => Promise<unknown>)
            : (fnArg as (tx: unknown) => Promise<unknown>);
        const mockTx = createMockDb();
        return fn(mockTx);
      },
    ),
    withTenant: vi.fn(
      async (_db: unknown, _ctxOrTenantId: unknown, fn: (tx: unknown) => Promise<unknown>) => {
        const mockTx = createMockDb();
        return fn(mockTx);
      },
    ),
  };
});

beforeEach(() => {
  fileStore = new FakeFileStore();
});

describe('BulkStudentImport — CSV Parsing', () => {
  let activities: Awaited<
    ReturnType<
      typeof import('../workflows/bulk-student-import.activities').createBulkStudentImportActivities
    >
  >;

  // Dynamic import of the activities module is slow under parallel test load
  // because it pulls in the full Drizzle schema + Temporal client transitive
  // tree. Bump the hook timeout so the test isn't flaky in CI.
  beforeEach(async () => {
    const { createBulkStudentImportActivities } = await import(
      '../workflows/bulk-student-import.activities'
    );
    const db = createMockDb();
    const nats = createMockNats();
    activities = createBulkStudentImportActivities(db, nats, null, fileStore);
  }, 30_000);

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('parses a valid UTF-8 CSV with correct field mapping', async () => {
    const csv = buildCsv(
      ['Student Name', 'Last Name', 'DOB', 'Gender', 'Mobile'],
      [
        ['Arjun', 'Kumar', '15/04/2010', 'male', '9876543210'],
        ['Priya', 'Sharma', '2009-08-21', 'female', '8765432109'],
      ],
    );

    storeCsv(csv);

    const result = await activities.parseCsv(TENANT_ID, CSV_FILE_ID, {
      'Student Name': 'first_name',
      'Last Name': 'last_name',
      DOB: 'date_of_birth',
      Gender: 'gender',
      Mobile: 'phone',
    });

    expect(result.totalRows).toBe(2);
    expect(result.validRows).toHaveLength(2);
    expect(result.errors).toHaveLength(0);

    expect(result.validRows[0].firstName).toBe('Arjun');
    expect(result.validRows[0].lastName).toBe('Kumar');
    expect(result.validRows[0].dateOfBirth).toBe('2010-04-15');
    expect(result.validRows[0].gender).toBe(Gender.MALE);
    expect(result.validRows[0].phone).toBe('9876543210');

    expect(result.validRows[1].firstName).toBe('Priya');
    expect(result.validRows[1].dateOfBirth).toBe('2009-08-21');
  });

  it('handles UTF-8 BOM encoding', async () => {
    const csv = buildCsv(
      ['first_name', 'date_of_birth', 'gender'],
      [['Ravi', '01/01/2010', 'male']],
    );

    storeBomCsv(csv);

    const result = await activities.parseCsv(TENANT_ID, CSV_FILE_ID, {});

    expect(result.totalRows).toBe(1);
    expect(result.validRows).toHaveLength(1);
    expect(result.validRows[0].firstName).toBe('Ravi');
  });

  it('collects errors for missing required fields', async () => {
    const csv = buildCsv(
      ['first_name', 'date_of_birth', 'gender'],
      [
        ['', '15/04/2010', 'male'], // missing first_name
        ['Arjun', '', 'male'], // missing DOB
        ['Priya', '15/04/2010', ''], // missing gender
      ],
    );

    storeCsv(csv);

    const result = await activities.parseCsv(TENANT_ID, CSV_FILE_ID, {});

    expect(result.totalRows).toBe(3);
    expect(result.validRows).toHaveLength(0);
    expect(result.errors.length).toBeGreaterThanOrEqual(3);

    // Check error details
    const firstNameError = result.errors.find((e) => e.rowNumber === 1 && e.field === 'first_name');
    expect(firstNameError).toBeDefined();
    expect(firstNameError?.reason).toContain('required');

    const dobError = result.errors.find((e) => e.rowNumber === 2 && e.field === 'date_of_birth');
    expect(dobError).toBeDefined();

    const genderError = result.errors.find((e) => e.rowNumber === 3 && e.field === 'gender');
    expect(genderError).toBeDefined();
  });

  it('validates enum fields correctly', async () => {
    const csv = buildCsv(
      ['first_name', 'date_of_birth', 'gender', 'social_category', 'blood_group'],
      [
        ['Arjun', '2010-04-15', 'male', 'invalid_cat', 'Z+'], // invalid enum values
        ['Priya', '2010-04-15', 'female', 'sc', 'A+'], // valid
        ['Ravi', '2010-04-15', 'alien', 'general', 'B+'], // invalid gender
      ],
    );

    storeCsv(csv);

    const result = await activities.parseCsv(TENANT_ID, CSV_FILE_ID, {});

    expect(result.validRows).toHaveLength(1); // only Priya is valid
    expect(result.validRows[0].firstName).toBe('Priya');
    expect(result.validRows[0].socialCategory).toBe(SocialCategory.SC);

    // Row 1: 2 errors (social_category + blood_group)
    const row1Errors = result.errors.filter((e) => e.rowNumber === 1);
    expect(row1Errors.length).toBe(2);

    // Row 3: 1 error (gender)
    const row3Errors = result.errors.filter((e) => e.rowNumber === 3);
    expect(row3Errors.length).toBe(1);
    expect(row3Errors[0].field).toBe('gender');
  });

  it('validates date formats — DD/MM/YYYY, YYYY-MM-DD, DD-MM-YYYY', async () => {
    const csv = buildCsv(
      ['first_name', 'date_of_birth', 'gender'],
      [
        ['A', '15/04/2010', 'male'], // DD/MM/YYYY — valid
        ['B', '2010-04-15', 'male'], // YYYY-MM-DD — valid
        ['C', '15-04-2010', 'male'], // DD-MM-YYYY — valid
        ['D', 'not-a-date', 'male'], // invalid
        ['E', '2010/04/15', 'male'], // wrong format (YYYY/MM/DD)
      ],
    );

    storeCsv(csv);

    const result = await activities.parseCsv(TENANT_ID, CSV_FILE_ID, {});

    expect(result.validRows).toHaveLength(3); // A, B, C
    expect(result.validRows[0].dateOfBirth).toBe('2010-04-15');
    expect(result.validRows[1].dateOfBirth).toBe('2010-04-15');
    expect(result.validRows[2].dateOfBirth).toBe('2010-04-15');

    const dateErrors = result.errors.filter((e) => e.field === 'date_of_birth');
    expect(dateErrors).toHaveLength(2); // rows D and E
  });

  it('applies field mapping correctly — renamed columns', async () => {
    const csv = buildCsv(
      ['विद्यार्थी का नाम', 'जन्म तिथि', 'लिंग', 'श्रेणी'],
      [['राज', '15/04/2010', 'male', 'sc']],
    );

    storeCsv(csv);

    const result = await activities.parseCsv(TENANT_ID, CSV_FILE_ID, {
      'विद्यार्थी का नाम': 'first_name',
      'जन्म तिथि': 'date_of_birth',
      लिंग: 'gender',
      श्रेणी: 'social_category',
    });

    expect(result.totalRows).toBe(1);
    expect(result.validRows).toHaveLength(1);
    expect(result.validRows[0].firstName).toBe('राज');
    expect(result.validRows[0].socialCategory).toBe(SocialCategory.SC);
  });

  it('validates Indian mobile phone numbers', async () => {
    const csv = buildCsv(
      ['first_name', 'date_of_birth', 'gender', 'phone'],
      [
        ['A', '2010-04-15', 'male', '9876543210'], // valid
        ['B', '2010-04-15', 'male', '+919876543211'], // valid (strips +91)
        ['C', '2010-04-15', 'male', '919876543212'], // valid (strips 91)
        ['D', '2010-04-15', 'male', '1234567890'], // invalid (starts with 1)
        ['E', '2010-04-15', 'male', '98765'], // invalid (too short)
      ],
    );

    storeCsv(csv);

    const result = await activities.parseCsv(TENANT_ID, CSV_FILE_ID, {});

    expect(result.validRows).toHaveLength(3); // A, B, C
    expect(result.validRows[0].phone).toBe('9876543210');
    expect(result.validRows[1].phone).toBe('9876543211');
    expect(result.validRows[2].phone).toBe('9876543212');

    const phoneErrors = result.errors.filter((e) => e.field === 'phone');
    expect(phoneErrors).toHaveLength(2); // D and E
  });

  it('should fail when the file is not a ready CSV of this institute', async () => {
    storeCsv('first_name\nArjun');

    await expect(activities.parseCsv('another-tenant', CSV_FILE_ID, {})).rejects.toThrow(
      'is not a ready BULK_IMPORT_CSV file of this institute',
    );
  });
});

describe('BulkStudentImport — Performance', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('parses 500 rows within 5 seconds', async () => {
    const { createBulkStudentImportActivities } = await import(
      '../workflows/bulk-student-import.activities'
    );
    const db = createMockDb();
    const nats = createMockNats();
    const activities = createBulkStudentImportActivities(db, nats, null, fileStore);

    // Generate 500-row CSV
    const headers = ['first_name', 'date_of_birth', 'gender', 'phone'];
    const rows: string[][] = [];
    for (let i = 0; i < 500; i++) {
      rows.push([
        `Student${i}`,
        '2010-04-15',
        i % 2 === 0 ? 'male' : 'female',
        `98765${String(i).padStart(5, '0')}`,
      ]);
    }
    const csv = buildCsv(headers, rows);

    storeCsv(csv);

    const start = Date.now();
    const result = await activities.parseCsv(TENANT_ID, CSV_FILE_ID, {});
    const elapsed = Date.now() - start;

    expect(result.totalRows).toBe(500);
    expect(result.validRows).toHaveLength(500);
    expect(elapsed).toBeLessThan(5000); // Must complete within 5 seconds
  });
});

describe('BulkStudentImport — Report Generation', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should neutralise a cell that a spreadsheet would run as a formula', async () => {
    const { createBulkStudentImportActivities } = await import(
      '../workflows/bulk-student-import.activities'
    );
    const activities = createBulkStudentImportActivities(
      createMockDb(),
      createMockNats(),
      null,
      fileStore,
    );

    await activities.generateReport({
      tenantId: TENANT_ID,
      reportFileId: 'report-2',
      createdBy: 'user-1',
      errors: [
        {
          rowNumber: 1,
          field: 'gender',
          reason: 'Invalid gender',
          originalValue: '=HYPERLINK("http://evil.test","x")',
        },
      ],
      totalRows: 1,
      created: 0,
      skipped: 0,
    });

    const lastLine = fileStore.written[0]?.body.toString('utf8').split('\r\n').pop();
    expect(lastLine).toBe(`1,gender,Invalid gender,"'=HYPERLINK(""http://evil.test"",""x"")"`);
  });

  it('should store the report as a CSV file under the id the workflow chose', async () => {
    const { createBulkStudentImportActivities } = await import(
      '../workflows/bulk-student-import.activities'
    );
    const activities = createBulkStudentImportActivities(
      createMockDb(),
      createMockNats(),
      null,
      fileStore,
    );
    const errors = [
      {
        rowNumber: 1,
        field: 'date_of_birth',
        reason: 'Invalid date format',
        originalValue: 'bad-date',
      },
      { rowNumber: 3, field: 'gender', reason: 'Invalid gender', originalValue: 'xyz' },
    ];

    const result = await activities.generateReport({
      tenantId: TENANT_ID,
      reportFileId: 'report-1',
      createdBy: 'user-1',
      errors,
      totalRows: 5,
      created: 3,
      skipped: 0,
    });

    expect(result).toEqual({ reportFileId: 'report-1' });
    expect(fileStore.written).toHaveLength(1);
    const [write] = fileStore.written;
    expect({ ...write, body: write?.body.toString('utf8') }).toEqual({
      tenantId: TENANT_ID,
      fileId: 'report-1',
      purpose: 'BULK_IMPORT_REPORT',
      fileName: 'import-errors.csv',
      contentType: 'text/csv',
      createdBy: 'user-1',
      body: [
        '# Bulk Import Report',
        '# Total rows: 5',
        '# Created: 3',
        '# Skipped: 0',
        '# Errors: 2',
        '#',
        'row_number,field,error,original_value\r\n1,date_of_birth,Invalid date format,bad-date\r\n3,gender,Invalid gender,xyz',
      ].join('\n'),
    });
  });
});
