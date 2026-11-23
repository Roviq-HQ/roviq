import { Module } from '@nestjs/common';
import { GroupDrizzleRepository } from './group.drizzle-repository';
import { GroupRepository } from './group.repository';

@Module({
  providers: [{ provide: GroupRepository, useClass: GroupDrizzleRepository }],
  exports: [GroupRepository],
})
export class GroupRepositoryModule {}
