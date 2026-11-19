import { Injectable } from '@nestjs/common';
import { type HealthIndicatorResult, HealthIndicatorService } from '@nestjs/terminus';
import { StorageClient } from '@roviq/storage';
import { logProbeFailure, type ProbeResult, runProbe } from './probe';

@Injectable()
export class StorageHealthIndicator {
  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    private readonly storage: StorageClient,
  ) {}

  // Uploads and downloads fail when a bucket is missing even though the server answers.
  probe(): Promise<ProbeResult> {
    return runProbe(async () => {
      const [privateOk, publicOk] = await Promise.all([
        this.storage.bucketExists('private'),
        this.storage.bucketExists('public'),
      ]);
      if (!privateOk) throw new Error('Private storage bucket is missing');
      if (!publicOk) throw new Error('Public storage bucket is missing');
    });
  }

  async isHealthy(): Promise<HealthIndicatorResult<'storage'>> {
    const indicator = this.healthIndicatorService.check('storage');
    const result = await this.probe();
    if (result.up) return indicator.up({ responseMs: result.responseMs });
    logProbeFailure('storage', result);
    return indicator.down();
  }
}
