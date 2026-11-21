import { Module } from '@nestjs/common';
import { TcVerificationRepository } from './tc-verification.repository';
import { TcVerificationResolver } from './tc-verification.resolver';

/** Queries anyone may call without signing in, to check a printed document. */
@Module({
  providers: [TcVerificationRepository, TcVerificationResolver],
})
export class PublicVerificationModule {}
