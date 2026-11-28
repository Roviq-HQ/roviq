import { Args, Query, Resolver } from '@nestjs/graphql';
import { TcStatus } from '@roviq/common-types';
import { RateLimit } from '../common/rate-limit/rate-limit.decorator';
import { TcVerificationModel } from './tc-verification.model';
import { TcVerificationRepository } from './tc-verification.repository';

const VALID_STATUSES: readonly TcStatus[] = [TcStatus.ISSUED, TcStatus.DUPLICATE_ISSUED];
// 24 random bytes in base64url; anything else cannot be a token and is not looked up.
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{32}$/;

// Public on purpose: anyone holding a printed TC scans its QR code without signing in.
@Resolver(() => TcVerificationModel)
export class TcVerificationResolver {
  constructor(private readonly verifications: TcVerificationRepository) {}

  @Query(() => TcVerificationModel, {
    nullable: true,
    description:
      'Public check of a transfer certificate by the token in its QR code. Null when no TC has the token.',
  })
  @RateLimit('publicLookup')
  async verifyTC(@Args('token') token: string): Promise<TcVerificationModel | null> {
    if (!TOKEN_SHAPE.test(token)) return null;
    const row = await this.verifications.findByToken(token);
    if (!row) return null;
    return {
      serialNumber: row.serialNumber,
      isValid: VALID_STATUSES.includes(row.status),
      studentName: row.studentName,
      instituteName: row.instituteName,
      issuedOn: row.issuedOn,
      isDuplicate: row.isDuplicate,
    };
  }
}
