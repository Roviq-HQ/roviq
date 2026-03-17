import { Module } from '@nestjs/common';
import { InstituteResolver } from './institute.resolver';
import { InstituteService } from './institute.service';
import { InstituteRepositoryModule } from './repositories/institute-repository.module';

@Module({
  imports: [InstituteRepositoryModule],
  providers: [InstituteService, InstituteResolver],
})
export class InstituteModule {}
