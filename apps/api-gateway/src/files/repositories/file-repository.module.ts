import { Module } from '@nestjs/common';
import { FileDrizzleRepository } from './file.drizzle-repository';
import { FileRepository } from './file.repository';

@Module({
  providers: [{ provide: FileRepository, useClass: FileDrizzleRepository }],
  exports: [FileRepository],
})
export class FileRepositoryModule {}
