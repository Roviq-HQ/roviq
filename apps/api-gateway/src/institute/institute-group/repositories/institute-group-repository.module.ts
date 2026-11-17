import { Module } from '@nestjs/common';
import { InstituteGroupDrizzleRepository } from './institute-group.drizzle-repository';
import { InstituteGroupRepository } from './institute-group.repository';

@Module({
  providers: [{ provide: InstituteGroupRepository, useClass: InstituteGroupDrizzleRepository }],
  exports: [InstituteGroupRepository],
})
export class InstituteGroupRepositoryModule {}
