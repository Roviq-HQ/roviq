import { Module } from '@nestjs/common';
import {
  MembershipAbilityDrizzleRepository,
  MembershipAbilityRepository,
  RoleDrizzleRepository,
  RoleRepository,
} from '@roviq/casl';

@Module({
  providers: [
    { provide: RoleRepository, useClass: RoleDrizzleRepository },
    { provide: MembershipAbilityRepository, useClass: MembershipAbilityDrizzleRepository },
  ],
  exports: [RoleRepository, MembershipAbilityRepository],
})
export class CaslRepositoryModule {}
