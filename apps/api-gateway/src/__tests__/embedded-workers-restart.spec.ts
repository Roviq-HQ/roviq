import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EventBusService } from '@roviq/event-bus';
import { FakeStorageClient } from '@roviq/storage';
import { EMBEDDED_WORKER_RESTART_DELAY_MS, type EmbeddedTemporalWorker } from '@roviq/temporal';
import { createMock } from '@roviq/testing';
import { NativeConnection } from '@temporalio/worker';
import { Pool } from 'pg';
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';
import { AuditPartitionWorkerService } from '../audit/workflows/partition.worker';
import type { IdentityService } from '../auth/identity.service';
import { FileSweeperWorkerService } from '../files/workflows/file-sweeper.worker';
import { StudentAdmissionWorkerService } from '../institute/admission/workflows/student-admission.worker';
import { ComplianceExportWorkerService } from '../institute/certificate/workflows/compliance-export.worker';
import { TCIssuanceWorkerService } from '../institute/certificate/workflows/tc-issuance.worker';
import type { InstituteSetupService } from '../institute/management/seed/institute-setup.service';
import { InstituteSetupWorkerService } from '../institute/setup/institute-setup.worker';
import { BulkStudentImportWorkerService } from '../institute/student/workflows/bulk-student-import.worker';

const cases: Array<{
  flag: string;
  label: string;
  build: (config: ConfigService) => EmbeddedTemporalWorker;
}> = [
  {
    flag: 'STUDENT_ADMISSION_WORKER_ENABLED',
    label: 'Student admission worker',
    build: (config) =>
      new StudentAdmissionWorkerService(
        config,
        createMock<EventBusService>(),
        createMock<IdentityService>(),
      ),
  },
  {
    flag: 'INSTITUTE_SETUP_WORKER_ENABLED',
    label: 'Institute setup worker',
    build: (config) =>
      new InstituteSetupWorkerService(
        config,
        createMock<EventBusService>(),
        createMock<InstituteSetupService>(),
      ),
  },
  {
    flag: 'TC_ISSUANCE_WORKER_ENABLED',
    label: 'TC issuance worker',
    build: (config) => new TCIssuanceWorkerService(config),
  },
  {
    flag: 'AUDIT_PARTITION_WORKER_ENABLED',
    label: 'Audit partition worker',
    build: (config) => new AuditPartitionWorkerService(config),
  },
  {
    flag: 'STUDENT_IMPORT_WORKER_ENABLED',
    label: 'Student import worker',
    build: (config) =>
      new BulkStudentImportWorkerService(
        config,
        createMock<IdentityService>(),
        new FakeStorageClient(),
      ),
  },
  {
    flag: 'COMPLIANCE_EXPORT_WORKER_ENABLED',
    label: 'Compliance export worker',
    build: (config) =>
      new ComplianceExportWorkerService(
        config,
        new FakeStorageClient(),
        createMock<EventBusService>(),
      ),
  },
  {
    flag: 'FILE_SWEEPER_WORKER_ENABLED',
    label: 'File sweeper worker',
    build: (config) => new FileSweeperWorkerService(config, new FakeStorageClient()),
  },
];

describe('gateway Temporal workers', () => {
  let warn: MockInstance<Logger['warn']>;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.spyOn(Pool.prototype, 'end').mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it.each(cases)('should start the $label again 30 s after it stops', async ({
    flag,
    label,
    build,
  }) => {
    // ConfigService prefers process.env; a developer's .env must not decide the flag.
    vi.stubEnv(flag, undefined);
    const connect = vi
      .spyOn(NativeConnection, 'connect')
      .mockRejectedValue(new Error('temporal unreachable'));
    const worker = build(
      new ConfigService({ [flag]: 'true', DATABASE_URL: 'postgresql://nobody@127.0.0.1:1/none' }),
    );

    worker.onModuleInit();
    await vi.waitFor(() =>
      expect(warn).toHaveBeenCalledWith(
        `${label} will try to start again in ${EMBEDDED_WORKER_RESTART_DELAY_MS} ms`,
      ),
    );
    expect(connect).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(EMBEDDED_WORKER_RESTART_DELAY_MS);

    await vi.waitFor(() => expect(connect).toHaveBeenCalledTimes(2));
    await worker.onModuleDestroy();
  });
});
