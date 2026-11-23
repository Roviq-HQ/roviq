import { Module } from '@nestjs/common';
import { ConsentDrizzleRepository } from './consent.drizzle-repository';
import { ConsentRepository } from './consent.repository';

@Module({
  providers: [{ provide: ConsentRepository, useClass: ConsentDrizzleRepository }],
  exports: [ConsentRepository],
})
export class ConsentRepositoryModule {}
