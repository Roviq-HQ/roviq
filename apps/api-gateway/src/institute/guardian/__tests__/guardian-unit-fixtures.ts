import { GuardianRelationship } from '@roviq/common-types';
import type { EventBusService } from '@roviq/event-bus';
import { createMock } from '@roviq/testing';
import { vi } from 'vitest';
import type { IdentityService } from '../../../auth/identity.service';
import type { SignInDetailsService } from '../../sign-in-details/sign-in-details.service';
import { GuardianService } from '../guardian.service';
import { GuardianRepository } from '../repositories/guardian.repository';
import type { StudentGuardianLinkRow } from '../repositories/types';

export function linkRow(overrides: Partial<StudentGuardianLinkRow>): StudentGuardianLinkRow {
  return {
    id: 'link',
    tenantId: 'tenant-1',
    studentProfileId: 's1',
    guardianProfileId: 'g1',
    relationship: GuardianRelationship.FATHER,
    isPrimaryContact: false,
    isEmergencyContact: false,
    canPickup: true,
    livesWith: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    createdBy: 'user-1',
    updatedBy: 'user-1',
    deletedAt: null,
    deletedBy: null,
    version: 1,
    ...overrides,
  };
}

export function buildGuardianService() {
  const repo = createMock<GuardianRepository>();
  const emit = vi.fn();
  const service = new GuardianService(
    repo,
    createMock<EventBusService>({ emit }),
    createMock<IdentityService>(),
    createMock<SignInDetailsService>(),
  );
  return { service, repo, emit };
}
