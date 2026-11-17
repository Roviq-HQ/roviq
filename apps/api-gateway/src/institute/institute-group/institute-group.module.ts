import { Module } from '@nestjs/common';
import { InstituteGroupResolver } from './institute-group.resolver';
import { InstituteGroupService } from './institute-group.service';
import { InstituteGroupRepositoryModule } from './repositories/institute-group-repository.module';

@Module({
  imports: [InstituteGroupRepositoryModule],
  providers: [InstituteGroupService, InstituteGroupResolver],
  exports: [InstituteGroupService],
})
export class InstituteGroupModule {}
