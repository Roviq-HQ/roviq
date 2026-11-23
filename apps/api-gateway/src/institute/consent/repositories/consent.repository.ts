import type {
  ConsentGrantData,
  ConsentRecordRow,
  ConsentWriteData,
  LatestConsentRow,
} from './types';

export abstract class ConsentRepository {
  /** The caller's guardian profile id in this institute, or null when the membership is no guardian. */
  abstract findGuardianProfileId(tenantId: string, membershipId: string): Promise<string | null>;
  abstract isGuardianLinkedToStudent(
    tenantId: string,
    guardianProfileId: string,
    studentProfileId: string,
  ): Promise<boolean>;
  abstract insertGrant(data: ConsentGrantData): Promise<ConsentRecordRow>;
  abstract insertWithdrawal(data: ConsentWriteData): Promise<ConsentRecordRow>;
  /** Latest consent row per purpose for one student. */
  abstract latestForStudent(
    tenantId: string,
    studentProfileId: string,
  ): Promise<LatestConsentRow[]>;
  /** Latest consent row per (student, purpose) given by one guardian. */
  abstract latestForGuardian(
    tenantId: string,
    guardianProfileId: string,
  ): Promise<LatestConsentRow[]>;
}
