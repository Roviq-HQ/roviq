/**
 * Consent service (ROV-165).
 *
 * Manages DPDP Act 2023 verifiable parental consent for data processing purposes.
 * Consent records are APPEND-ONLY — each grant or withdrawal creates a new row.
 * The latest row per (guardian, student, purpose) determines current consent state.
 */

import { Injectable } from '@nestjs/common';
import { BusinessException, ErrorCode } from '@roviq/common-types';
import { EventBusService } from '@roviq/event-bus';
import { EVENT_PATTERNS } from '@roviq/nats-jetstream';
import { getRequestContext } from '@roviq/request-context';
import type { GrantConsentInput } from './dto/grant-consent.input';
import type { WithdrawConsentInput } from './dto/withdraw-consent.input';
import { ConsentRepository } from './repositories/consent.repository';
import type { LatestConsentRow } from './repositories/types';

interface ConsentMetadata {
  ipAddress?: string;
  userAgent?: string;
}

function toConsentStatus(row: LatestConsentRow) {
  return {
    studentProfileId: row.student_profile_id,
    purpose: row.purpose,
    isGranted: row.is_granted,
    lastUpdatedAt: row.created_at ? new Date(row.created_at) : null,
  };
}

@Injectable()
export class ConsentService {
  constructor(
    private readonly repo: ConsentRepository,
    private readonly eventBus: EventBusService,
  ) {}

  private get tenantId(): string {
    const { tenantId } = getRequestContext();
    if (!tenantId) throw new Error('Tenant context required');
    return tenantId;
  }

  /**
   * Resolves guardian profile ID from the user's membership ID.
   * Each guardian has exactly one guardian_profile per institute (unique membershipId).
   */
  private async resolveGuardianProfileId(tenantId: string, membershipId: string): Promise<string> {
    const id = await this.repo.findGuardianProfileId(tenantId, membershipId);
    if (id === null) {
      throw new BusinessException(ErrorCode.FORBIDDEN, 'Only guardians can manage consent records');
    }
    return id;
  }

  private async validateGuardianStudentLink(
    tenantId: string,
    guardianProfileId: string,
    studentProfileId: string,
  ): Promise<void> {
    const linked = await this.repo.isGuardianLinkedToStudent(
      tenantId,
      guardianProfileId,
      studentProfileId,
    );
    if (!linked) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        'Guardian is not linked to the specified student',
      );
    }
  }

  /**
   * Grant consent for a specific data processing purpose.
   * Creates a new append-only consent record with is_granted=true.
   */
  async grantConsent(membershipId: string, input: GrantConsentInput, metadata: ConsentMetadata) {
    const tenantId = this.tenantId;
    const guardianProfileId = await this.resolveGuardianProfileId(tenantId, membershipId);

    await this.validateGuardianStudentLink(tenantId, guardianProfileId, input.studentProfileId);

    const record = await this.repo.insertGrant({
      tenantId,
      guardianProfileId,
      studentProfileId: input.studentProfileId,
      purpose: input.purpose,
      verificationMethod: input.verificationMethod ?? null,
      ipAddress: metadata.ipAddress ?? null,
      userAgent: metadata.userAgent ?? null,
    });

    this.eventBus.emit(EVENT_PATTERNS.CONSENT.given, {
      tenantId,
      guardianProfileId,
      studentProfileId: input.studentProfileId,
      purpose: input.purpose,
    });

    return record;
  }

  /**
   * Withdraw consent for a specific data processing purpose.
   * Creates a NEW append-only row with is_granted=false (never updates existing rows).
   */
  async withdrawConsent(
    membershipId: string,
    input: WithdrawConsentInput,
    metadata: ConsentMetadata,
  ) {
    const tenantId = this.tenantId;
    const guardianProfileId = await this.resolveGuardianProfileId(tenantId, membershipId);

    await this.validateGuardianStudentLink(tenantId, guardianProfileId, input.studentProfileId);

    const record = await this.repo.insertWithdrawal({
      tenantId,
      guardianProfileId,
      studentProfileId: input.studentProfileId,
      purpose: input.purpose,
      ipAddress: metadata.ipAddress ?? null,
      userAgent: metadata.userAgent ?? null,
    });

    this.eventBus.emit(EVENT_PATTERNS.CONSENT.withdrawn, {
      tenantId,
      guardianProfileId,
      studentProfileId: input.studentProfileId,
      purpose: input.purpose,
    });

    return record;
  }

  /**
   * Get current consent status for every DPDP purpose for a single student.
   * Used by the guardian detail page (ROV-169) to render per-child consent
   * mini-badges. Returns one row per (purpose) with the latest state drawn
   * from `consent_records` — missing records are NOT materialised here; the
   * frontend treats absent purposes as "not yet granted / withdrawn".
   *
   * Scoped to the caller's tenant via withTenant + RLS; CASL `read Consent`
   * ability enforced at the resolver. No guardian/membership resolution
   * needed — the student itself is the scope anchor.
   */
  async consentStatusForStudent(studentProfileId: string) {
    const tenantId = this.tenantId;

    const rows = await this.repo.latestForStudent(tenantId, studentProfileId);
    return rows.map(toConsentStatus);
  }

  /**
   * Get current consent status for all (student, purpose) pairs linked to this guardian.
   * Uses DISTINCT ON to find the latest consent record per (student_profile_id, purpose).
   */
  async myConsentStatus(membershipId: string) {
    const tenantId = this.tenantId;
    const guardianProfileId = await this.resolveGuardianProfileId(tenantId, membershipId);

    const rows = await this.repo.latestForGuardian(tenantId, guardianProfileId);
    return rows.map(toConsentStatus);
  }
}
