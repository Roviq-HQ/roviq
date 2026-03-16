import { Module } from '@nestjs/common';
import { MembershipDrizzleRepository } from './membership.drizzle-repository';
import { MembershipRepository } from './membership.repository';
import { RefreshTokenDrizzleRepository } from './refresh-token.drizzle-repository';
import { RefreshTokenRepository } from './refresh-token.repository';
import { UserDrizzleRepository } from './user.drizzle-repository';
import { UserRepository } from './user.repository';

@Module({
  providers: [
    { provide: UserRepository, useClass: UserDrizzleRepository },
    { provide: MembershipRepository, useClass: MembershipDrizzleRepository },
    { provide: RefreshTokenRepository, useClass: RefreshTokenDrizzleRepository },
  ],
  exports: [UserRepository, MembershipRepository, RefreshTokenRepository],
})
export class AuthRepositoryModule {}
