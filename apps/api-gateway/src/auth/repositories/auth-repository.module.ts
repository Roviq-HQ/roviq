import { Module } from '@nestjs/common';
import { AuthEventDrizzleRepository } from './auth-event.drizzle-repository';
import { AuthEventRepository } from './auth-event.repository';
import { IdentityDrizzleRepository } from './identity.drizzle-repository';
import { IdentityRepository } from './identity.repository';
import { ImpersonationDrizzleRepository } from './impersonation.drizzle-repository';
import { ImpersonationRepository } from './impersonation.repository';
import { MembershipDrizzleRepository } from './membership.drizzle-repository';
import { MembershipRepository } from './membership.repository';
import { PlatformMembershipDrizzleRepository } from './platform-membership.drizzle-repository';
import { PlatformMembershipRepository } from './platform-membership.repository';
import { RefreshTokenDrizzleRepository } from './refresh-token.drizzle-repository';
import { RefreshTokenRepository } from './refresh-token.repository';
import { ResellerMembershipDrizzleRepository } from './reseller-membership.drizzle-repository';
import { ResellerMembershipRepository } from './reseller-membership.repository';
import { UserDrizzleRepository } from './user.drizzle-repository';
import { UserRepository } from './user.repository';

@Module({
  providers: [
    { provide: UserRepository, useClass: UserDrizzleRepository },
    { provide: MembershipRepository, useClass: MembershipDrizzleRepository },
    { provide: PlatformMembershipRepository, useClass: PlatformMembershipDrizzleRepository },
    { provide: ResellerMembershipRepository, useClass: ResellerMembershipDrizzleRepository },
    { provide: RefreshTokenRepository, useClass: RefreshTokenDrizzleRepository },
    { provide: IdentityRepository, useClass: IdentityDrizzleRepository },
    { provide: ImpersonationRepository, useClass: ImpersonationDrizzleRepository },
    { provide: AuthEventRepository, useClass: AuthEventDrizzleRepository },
  ],
  exports: [
    UserRepository,
    MembershipRepository,
    PlatformMembershipRepository,
    ResellerMembershipRepository,
    RefreshTokenRepository,
    IdentityRepository,
    ImpersonationRepository,
    AuthEventRepository,
  ],
})
export class AuthRepositoryModule {}
