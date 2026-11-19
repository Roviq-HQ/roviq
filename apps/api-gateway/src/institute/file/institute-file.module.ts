import { Module } from '@nestjs/common';
import { FilesModule } from '../../files/files.module';
import { InstituteFileResolver } from './institute-file.resolver';

@Module({
  imports: [FilesModule],
  providers: [InstituteFileResolver],
})
export class InstituteFileModule {}
