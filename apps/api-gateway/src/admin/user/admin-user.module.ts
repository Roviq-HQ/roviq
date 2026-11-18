import { Module } from '@nestjs/common';
import { AdminUserResolver } from './admin-user.resolver';
import { AdminUserService } from './admin-user.service';
import { AdminUserDrizzleRepository } from './repositories/admin-user.drizzle-repository';
import { AdminUserRepository } from './repositories/admin-user.repository';

@Module({
  providers: [
    { provide: AdminUserRepository, useClass: AdminUserDrizzleRepository },
    AdminUserService,
    AdminUserResolver,
  ],
})
export class AdminUserModule {}
