import { Global, Module } from '@nestjs/common';
import { S3StorageClient } from './s3-storage-client';
import { StorageClient } from './storage-client';

@Global()
@Module({
  providers: [{ provide: StorageClient, useClass: S3StorageClient }],
  exports: [StorageClient],
})
export class StorageModule {}
