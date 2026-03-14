import { Module } from '@nestjs/common';
import { PlatformDatabaseModule } from '@roviq/nestjs-prisma';
import { MembershipPrismaRepository } from './membership.prisma-repository';
import { MembershipRepository } from './membership.repository';
import { RefreshTokenPrismaRepository } from './refresh-token.prisma-repository';
import { RefreshTokenRepository } from './refresh-token.repository';
import { UserPrismaRepository } from './user.prisma-repository';
import { UserRepository } from './user.repository';

@Module({
  imports: [PlatformDatabaseModule],
  providers: [
    { provide: UserRepository, useClass: UserPrismaRepository },
    { provide: MembershipRepository, useClass: MembershipPrismaRepository },
    { provide: RefreshTokenRepository, useClass: RefreshTokenPrismaRepository },
  ],
  exports: [UserRepository, MembershipRepository, RefreshTokenRepository],
})
export class AuthRepositoryModule {}
