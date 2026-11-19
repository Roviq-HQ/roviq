import { Module } from '@nestjs/common';
import { FilesModule } from '../../files/files.module';
import { LeaveResolver } from './leave.resolver';
import { LeaveService } from './leave.service';
import { LeaveRepositoryModule } from './repositories/leave-repository.module';

@Module({
  imports: [LeaveRepositoryModule, FilesModule],
  providers: [LeaveService, LeaveResolver],
  exports: [LeaveService],
})
export class LeaveModule {}
