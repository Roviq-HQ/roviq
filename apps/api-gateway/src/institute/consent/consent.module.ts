import { Module } from '@nestjs/common';
import { ConsentResolver } from './consent.resolver';
import { ConsentService } from './consent.service';
import { ConsentRepositoryModule } from './repositories/consent-repository.module';

@Module({
  imports: [ConsentRepositoryModule],
  providers: [ConsentService, ConsentResolver],
  exports: [ConsentService],
})
export class ConsentModule {}
