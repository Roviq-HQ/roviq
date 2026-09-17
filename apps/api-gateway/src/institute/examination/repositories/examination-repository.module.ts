import { Module } from '@nestjs/common';
import { ExaminationDrizzleRepository } from './examination.drizzle-repository';
import { ExaminationRepository } from './examination.repository';

@Module({
  providers: [{ provide: ExaminationRepository, useClass: ExaminationDrizzleRepository }],
  exports: [ExaminationRepository],
})
export class ExaminationRepositoryModule {}
