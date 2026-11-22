import { Inject, Injectable } from '@nestjs/common';
import type { TcStatus } from '@roviq/common-types';
import {
  DRIZZLE_DB,
  type DrizzleDB,
  type I18nContent,
  mkAdminCtx,
  withAdmin,
} from '@roviq/database';
import { sql } from 'drizzle-orm';
import type { TcVerificationRow } from './tc-verification.model';

interface VerifyTcRow extends Record<string, unknown> {
  serial_number: string;
  status: TcStatus;
  student_name: string | null;
  institute_name: I18nContent;
  issued_on: string | null;
  is_duplicate: boolean;
}

/**
 * The public TC check. The caller is anonymous, so the lookup goes through the `verify_tc`
 * database function, which returns only the fields of the verification page for one token.
 */
@Injectable()
export class TcVerificationRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDB) {}

  async findByToken(token: string): Promise<TcVerificationRow | null> {
    const result = await withAdmin(this.db, mkAdminCtx('service:tc-verification'), (tx) =>
      tx.execute<VerifyTcRow>(sql`SELECT * FROM verify_tc(${token})`),
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      serialNumber: row.serial_number,
      status: row.status,
      studentName: row.student_name,
      instituteName: row.institute_name,
      issuedOn: row.issued_on,
      isDuplicate: row.is_duplicate,
    };
  }
}
