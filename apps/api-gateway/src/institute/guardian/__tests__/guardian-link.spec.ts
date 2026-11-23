/**
 * ROV-169 — Unit tests for GuardianService link/unlink/revoke paths.
 *
 * Covers the positive happy-path for `linkToStudent` (student lookup → guardian lookup →
 * insert), plus the "unlinking the last guardian without replacement" rejection and
 * `revokeAccess` flipping `canPickup=false`.
 *
 * `guardian-linking.spec.ts` already owns the exhaustive negative paths for
 * unlink (no link, primary without replacement, last-guardian) and revoke
 * (link not found); this file complements it with the positive-link flow.
 */
import assert from 'node:assert';
import { BusinessException, ErrorCode, GuardianRelationship } from '@roviq/common-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LockedGuardianLink } from '../repositories/types';
import { buildGuardianService, linkRow } from './guardian-unit-fixtures';

vi.mock('@roviq/request-context', () => ({
  getRequestContext: vi.fn(() => ({
    tenantId: 'tenant-1',
    userId: 'user-1',
    correlationId: 'test',
  })),
}));

describe('GuardianService — linkToStudent (unit)', () => {
  let ctx: ReturnType<typeof buildGuardianService>;

  beforeEach(() => {
    ctx = buildGuardianService();
  });

  it('inserts studentGuardianLinks with values from input and returns link', async () => {
    const created = linkRow({ id: 'link-1', studentProfileId: 'stu-1', guardianProfileId: 'g-1' });
    vi.mocked(ctx.repo.studentExists).mockResolvedValue(true);
    vi.mocked(ctx.repo.guardianExists).mockResolvedValue(true);
    vi.mocked(ctx.repo.createLink).mockResolvedValue({ kind: 'ok', link: created });

    const link = await ctx.service.linkToStudent({
      studentProfileId: 'stu-1',
      guardianProfileId: 'g-1',
      relationship: GuardianRelationship.FATHER,
    });

    expect(link).toEqual(created);
    expect(ctx.repo.createLink).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      actorId: 'user-1',
      studentProfileId: 'stu-1',
      guardianProfileId: 'g-1',
      relationship: GuardianRelationship.FATHER,
      isPrimaryContact: false,
      isEmergencyContact: false,
      canPickup: true,
      livesWith: true,
    });
  });
});

describe('GuardianService — unlinkFromStudent last-guardian guard (unit)', () => {
  let ctx: ReturnType<typeof buildGuardianService>;

  beforeEach(() => {
    ctx = buildGuardianService();
  });

  it('throws when attempting to unlink the last guardian', async () => {
    const onlyLink: LockedGuardianLink[] = [
      { id: 'link-1', guardianProfileId: 'g-1', isPrimaryContact: false },
    ];
    vi.mocked(ctx.repo.unlink).mockImplementation(async (_t, _s, _a, plan) => {
      plan(onlyLink);
    });

    const err = await ctx.service
      .unlinkFromStudent({ guardianProfileId: 'g-1', studentProfileId: 's-1' })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(BusinessException);
    assert(err instanceof BusinessException);
    expect(err.code).toBe(ErrorCode.LAST_GUARDIAN_CANNOT_BE_DELETED);
  });
});

describe('GuardianService — revokeAccess (unit)', () => {
  let ctx: ReturnType<typeof buildGuardianService>;

  beforeEach(() => {
    ctx = buildGuardianService();
  });

  it('returns a link with canPickup=false', async () => {
    vi.mocked(ctx.repo.revokeAccess).mockResolvedValue(
      linkRow({ id: 'link-1', canPickup: false, isPrimaryContact: false }),
    );

    const result = await ctx.service.revokeAccess({
      guardianProfileId: 'g-1',
      studentProfileId: 's-1',
      reason: 'Court order',
    });

    expect(result.canPickup).toBe(false);
    expect(result.isPrimaryContact).toBe(false);
  });
});
