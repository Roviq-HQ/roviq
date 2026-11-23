import { Module } from '@nestjs/common';
import { AdminAttendanceResolver } from './admin-attendance.resolver';
import { AdminAttendanceService } from './admin-attendance.service';
import { AdminAttendanceRepositoryModule } from './repositories/admin-attendance-repository.module';

@Module({
  imports: [AdminAttendanceRepositoryModule],
  providers: [AdminAttendanceService, AdminAttendanceResolver],
})
export class AdminAttendanceModule {}
