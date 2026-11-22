import { Reflector } from '@nestjs/core';
import { getAuditMaskedFields, NoAudit } from '@roviq/audit';
import { describe, expect, it } from 'vitest';
import { AuthResolver } from '../auth.resolver';
import { ChangePasswordArgs } from '../dto/change-password.args';

describe('password change audit', () => {
  it('masks both passwords and skips raw mutation argument logging', () => {
    expect(getAuditMaskedFields(ChangePasswordArgs)).toEqual(['currentPassword', 'newPassword']);
    expect(new Reflector().get(NoAudit, AuthResolver.prototype.changePassword)).toBeTruthy();
  });
});
