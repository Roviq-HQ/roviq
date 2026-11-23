import { Module } from '@nestjs/common';
import { StaffDrizzleRepository } from './staff.drizzle-repository';
import { StaffRepository } from './staff.repository';
import { StaffQualificationDrizzleRepository } from './staff-qualification.drizzle-repository';
import { StaffQualificationRepository } from './staff-qualification.repository';

@Module({
  providers: [
    { provide: StaffRepository, useClass: StaffDrizzleRepository },
    { provide: StaffQualificationRepository, useClass: StaffQualificationDrizzleRepository },
  ],
  exports: [StaffRepository, StaffQualificationRepository],
})
export class StaffRepositoryModule {}
