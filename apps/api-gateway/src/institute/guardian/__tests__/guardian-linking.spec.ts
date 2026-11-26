/**
 * Unit tests for guardian linking logic (ROV-157, PRD §3.2).
 *
 * Tests validation rules for:
 * 1. Unlinking primary contact without replacement → error
 * 2. Unlinking last guardian → error
 * 3. Revoke access → canPickup=false, isPrimaryContact=false, link preserved
 * 4. Delete blocks if only guardian for a student
 */
import assert from 'node:assert';
import { BusinessException, ErrorCode } from '@roviq/common-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LockedGuardianLink, UnlinkPlan } from '../repositories/types';
import { buildGuardianService, linkRow } from './guardian-unit-fixtures';

vi.mock('@roviq/request-context', () => ({
  getRequestContext: vi.fn(() => ({
    tenantId: 'tenant-1',
    userId: 'user-1',
    correlationId: 'test',
  })),
}));

describe('Guardian — Unlink Validation', () => {
  let ctx: ReturnType<typeof buildGuardianService>;
  // What the repository did with the plan for the locked links: the plan, or nothing if refused.
  let planned: UnlinkPlan[];

  beforeEach(() => {
    ctx = buildGuardianService();
    planned = [];
  });

  // The repository locks these links and runs the service's plan inside its transaction.
  function lockedLinks(links: LockedGuardianLink[]) {
    vi.mocked(ctx.repo.unlink).mockImplementation(async (_t, _s, _a, plan) => {
      planned.push(plan(links));
    });
  }

  const primaryG1 = {
    id: 'link-1',
    guardianProfileId: 'g1',
    isPrimaryContact: true,
    accessRevoked: false,
  };
  const otherG2 = {
    id: 'link-2',
    guardianProfileId: 'g2',
    isPrimaryContact: false,
    accessRevoked: false,
  };

  async function unlinkError(input: Parameters<typeof ctx.service.unlinkFromStudent>[0]) {
    const err = await ctx.service.unlinkFromStudent(input).catch((e: unknown) => e);
    assert(err instanceof BusinessException);
    expect(planned).toEqual([]);
    return err.code;
  }

  it('unlinkFromStudent rejects when link not found', async () => {
    lockedLinks([otherG2]); // g1 not among the locked live links

    expect(await unlinkError({ guardianProfileId: 'g1', studentProfileId: 's1' })).toBe(
      ErrorCode.GUARDIAN_LINK_NOT_FOUND,
    );
  });

  it('unlinkFromStudent rejects unlink of primary without replacement', async () => {
    lockedLinks([primaryG1, otherG2]);

    expect(await unlinkError({ guardianProfileId: 'g1', studentProfileId: 's1' })).toBe(
      ErrorCode.PRIMARY_GUARDIAN_REQUIRED,
    );
  });

  it('unlinkFromStudent rejects unlinking the last guardian', async () => {
    lockedLinks([{ ...primaryG1, isPrimaryContact: false }]);

    expect(await unlinkError({ guardianProfileId: 'g1', studentProfileId: 's1' })).toBe(
      ErrorCode.LAST_GUARDIAN_CANNOT_BE_DELETED,
    );
  });

  it('unlinkFromStudent rejects a replacement primary that is not linked to the student', async () => {
    lockedLinks([primaryG1, otherG2]);

    expect(
      await unlinkError({
        guardianProfileId: 'g1',
        studentProfileId: 's1',
        newPrimaryGuardianId: 'g9',
      }),
    ).toBe(ErrorCode.REPLACEMENT_PRIMARY_GUARDIAN_INVALID);
  });

  it('unlinkFromStudent rejects the removed guardian as its own replacement', async () => {
    lockedLinks([primaryG1, otherG2]);

    expect(
      await unlinkError({
        guardianProfileId: 'g1',
        studentProfileId: 's1',
        newPrimaryGuardianId: 'g1',
      }),
    ).toBe(ErrorCode.REPLACEMENT_PRIMARY_GUARDIAN_INVALID);
  });

  it('unlinkFromStudent rejects a replacement whose access is revoked', async () => {
    lockedLinks([primaryG1, { ...otherG2, accessRevoked: true }]);

    expect(
      await unlinkError({
        guardianProfileId: 'g1',
        studentProfileId: 's1',
        newPrimaryGuardianId: 'g2',
      }),
    ).toBe(ErrorCode.REPLACEMENT_PRIMARY_GUARDIAN_INVALID);
  });

  it('unlinkFromStudent rejects a replacement when the removed link is not primary', async () => {
    lockedLinks([
      { ...otherG2, isPrimaryContact: true },
      { ...primaryG1, isPrimaryContact: false },
    ]);

    expect(
      await unlinkError({
        guardianProfileId: 'g1',
        studentProfileId: 's1',
        newPrimaryGuardianId: 'g2',
      }),
    ).toBe(ErrorCode.REPLACEMENT_PRIMARY_GUARDIAN_INVALID);
  });

  it('unlinkFromStudent soft-deletes the link, promotes the replacement and emits GUARDIAN.unlinked', async () => {
    lockedLinks([primaryG1, otherG2]);

    await expect(
      ctx.service.unlinkFromStudent({
        guardianProfileId: 'g1',
        studentProfileId: 's1',
        newPrimaryGuardianId: 'g2',
      }),
    ).resolves.toBe(true);

    expect(ctx.repo.unlink).toHaveBeenCalledTimes(1);
    expect(vi.mocked(ctx.repo.unlink).mock.calls[0]?.slice(0, 3)).toEqual([
      'tenant-1',
      's1',
      'user-1',
    ]);
    expect(planned).toEqual([{ linkId: 'link-1', replacementLinkId: 'link-2' }]);
    expect(ctx.emit).toHaveBeenCalledWith('GUARDIAN.unlinked', {
      guardianProfileId: 'g1',
      studentProfileId: 's1',
      newPrimaryGuardianId: 'g2',
      tenantId: 'tenant-1',
    });
  });
});

describe('Guardian — Revoke Access (Divorce)', () => {
  let ctx: ReturnType<typeof buildGuardianService>;

  beforeEach(() => {
    ctx = buildGuardianService();
  });

  it('revokeAccess returns link with canPickup=false', async () => {
    vi.mocked(ctx.repo.revokeAccess).mockResolvedValue(
      linkRow({ id: 'link-1', canPickup: false, isPrimaryContact: false }),
    );

    const result = await ctx.service.revokeAccess({
      guardianProfileId: 'g1',
      studentProfileId: 's1',
      reason: 'Court order',
    });

    expect(result.canPickup).toBe(false);
    expect(result.isPrimaryContact).toBe(false);
  });

  it('revokeAccess throws if link not found', async () => {
    vi.mocked(ctx.repo.revokeAccess).mockResolvedValue(null);

    await expect(
      ctx.service.revokeAccess({ guardianProfileId: 'g1', studentProfileId: 's1' }),
    ).rejects.toMatchObject({ code: ErrorCode.GUARDIAN_LINK_NOT_FOUND });
  });
});

describe('Guardian — Restore Access', () => {
  let ctx: ReturnType<typeof buildGuardianService>;

  beforeEach(() => {
    ctx = buildGuardianService();
  });

  it('restoreAccess returns the link with no revoke date', async () => {
    vi.mocked(ctx.repo.restoreAccess).mockResolvedValue(
      linkRow({ id: 'link-1', accessRevokedAt: null, accessRevokedBy: null }),
    );

    const result = await ctx.service.restoreAccess({
      guardianProfileId: 'g1',
      studentProfileId: 's1',
    });

    expect(result.accessRevokedAt).toBeNull();
    expect(ctx.repo.restoreAccess).toHaveBeenCalledWith(
      expect.any(String),
      's1',
      'g1',
      expect.any(String),
    );
  });

  it('restoreAccess throws if link not found', async () => {
    vi.mocked(ctx.repo.restoreAccess).mockResolvedValue(null);

    await expect(
      ctx.service.restoreAccess({ guardianProfileId: 'g1', studentProfileId: 's1' }),
    ).rejects.toMatchObject({ code: ErrorCode.GUARDIAN_LINK_NOT_FOUND });
  });
});

describe('Guardian — Delete Validation', () => {
  let ctx: ReturnType<typeof buildGuardianService>;

  beforeEach(() => {
    ctx = buildGuardianService();
  });

  it('delete blocks if guardian is only guardian for a student', async () => {
    vi.mocked(ctx.repo.listLinkedStudentIds).mockResolvedValue(['s1']); // guardian's links
    vi.mocked(ctx.repo.hasOtherGuardian).mockResolvedValue(false); // no other guardians for s1

    await expect(ctx.service.delete('g1')).rejects.toMatchObject({
      code: ErrorCode.LAST_GUARDIAN_CANNOT_BE_DELETED,
    });
    expect(ctx.repo.softDelete).not.toHaveBeenCalled();
  });
});
