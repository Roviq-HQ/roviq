import { Module } from '@nestjs/common';
import { TimetableDrizzleRepository } from './timetable.drizzle-repository';
import { TimetableRepository } from './timetable.repository';

@Module({
  providers: [{ provide: TimetableRepository, useClass: TimetableDrizzleRepository }],
  exports: [TimetableRepository],
})
export class TimetableRepositoryModule {}
