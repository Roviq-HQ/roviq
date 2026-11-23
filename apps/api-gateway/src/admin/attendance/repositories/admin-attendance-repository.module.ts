import { Module } from '@nestjs/common';
import { AdminAttendanceDrizzleRepository } from './admin-attendance.drizzle-repository';
import { AdminAttendanceRepository } from './admin-attendance.repository';

@Module({
  providers: [{ provide: AdminAttendanceRepository, useClass: AdminAttendanceDrizzleRepository }],
  exports: [AdminAttendanceRepository],
})
export class AdminAttendanceRepositoryModule {}
