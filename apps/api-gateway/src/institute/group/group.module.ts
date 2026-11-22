import { Module } from '@nestjs/common';
import { GroupResolver } from './group.resolver';
import { GroupService } from './group.service';
import { GroupInvalidationHandler } from './group-invalidation.handler';

@Module({
  controllers: [GroupInvalidationHandler],
  providers: [GroupService, GroupResolver],
  exports: [GroupService],
})
export class GroupModule {}
