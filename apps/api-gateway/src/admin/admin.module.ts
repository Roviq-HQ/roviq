import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminResellerResolver } from './reseller/admin-reseller.resolver';
import { AdminResellerService } from './reseller/admin-reseller.service';

@Module({
  imports: [
    AuthModule, // provides AuthEventService
  ],
  providers: [AdminResellerService, AdminResellerResolver],
})
export class AdminModule {}
