import type { InstituteContext } from '@roviq/common-types';
import type {
  CreateDuplicateTcData,
  CreateTcRequestData,
  IssueTcData,
  StudentStatusRow,
  TcDetailsRow,
  TcListFilter,
  TcRow,
} from './tc.types';

/**
 * Access to `tc_register` under the caller's institute. Reads go through the `*_live` views.
 * Every status write is conditional on the expected prior status and throws
 * INVALID_STATE_TRANSITION when the row has moved on.
 */
export abstract class TcRepository {
  abstract findStudentStatus(
    ctx: InstituteContext,
    studentProfileId: string,
  ): Promise<StudentStatusRow | null>;
  abstract academicYearExists(ctx: InstituteContext, academicYearId: string): Promise<boolean>;
  /** Null when the student already has a TC request in progress (uq_tc_register_open_request). */
  abstract createRequest(
    ctx: InstituteContext,
    data: CreateTcRequestData,
  ): Promise<{ id: string } | null>;
  /** Null when the original already has an open duplicate request (uq_tc_register_open_duplicate). */
  abstract createDuplicateRequest(
    ctx: InstituteContext,
    data: CreateDuplicateTcData,
  ): Promise<{ id: string } | null>;
  abstract findById(ctx: InstituteContext, id: string): Promise<TcRow | null>;
  /** GENERATED → APPROVED. TC_NOT_FOUND or INVALID_STATE_TRANSITION otherwise. */
  abstract approve(ctx: InstituteContext, id: string, actorId: string): Promise<void>;
  /** Any status the state machine lets reach CANCELLED; merges `rejection` into `tc_data`. */
  abstract cancel(
    ctx: InstituteContext,
    id: string,
    rejection: Record<string, string>,
    actorId: string,
  ): Promise<void>;
  /**
   * APPROVED → ISSUED with the next serial of the TC's year, and the student marked
   * TRANSFERRED_OUT, in one transaction. Returns the serial.
   */
  abstract issueOriginal(ctx: InstituteContext, data: IssueTcData): Promise<string>;
  /**
   * DUPLICATE_REQUESTED → DUPLICATE_ISSUED as `<original serial>-D<n>`, n counted in the same
   * transaction. Leaves the student untouched. Returns the serial.
   */
  abstract issueDuplicate(ctx: InstituteContext, data: IssueTcData): Promise<string>;
  abstract findDetails(ctx: InstituteContext, id: string): Promise<TcDetailsRow | null>;
  /** Newest first, at most 50. */
  abstract list(ctx: InstituteContext, filter: TcListFilter): Promise<TcDetailsRow[]>;
}
