/**
 * Service for bulk student import operations (ROV-155).
 *
 * Starts Temporal workflows and queries their progress.
 * Does NOT contain business logic — that lives in the Temporal activities.
 */
import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BusinessException, ErrorCode } from '@roviq/common-types';
import { isTenantWorkflowId, tenantWorkflowId } from '@roviq/temporal';
import { Client, Connection } from '@temporalio/client';
import { FileService } from '../../files/file.service';
import { assertAdmissionClass } from './admission-class';
import { StudentRepository } from './repositories/student.repository';
import type {
  BulkImportProgress,
  BulkStudentImportResult,
} from './workflows/bulk-student-import.types';

const TASK_QUEUE = 'student-bulk-import';

const WORKFLOW_KIND = 'bulk-student-import';

@Injectable()
export class StudentBulkImportService {
  private readonly logger = new Logger(StudentBulkImportService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly files: FileService,
    private readonly students: StudentRepository,
  ) {}

  /**
   * Start a BulkStudentImportWorkflow and return its workflow ID.
   * The caller uses the workflow ID to poll for progress.
   */
  async startBulkImport(input: {
    tenantId: string;
    fileId: string;
    academicYearId: string;
    standardId: string;
    sectionId: string;
    createdBy: string;
    fieldMapping: Record<string, string>;
  }): Promise<string> {
    // Before the file is claimed or the workflow starts: the workflow runs with a synthetic
    // context, so this is the only place the caller's own institute checks the three ids.
    assertAdmissionClass(
      await this.students.checkAdmissionClass(input.tenantId, {
        academicYearId: input.academicYearId,
        standardId: input.standardId,
        sectionId: input.sectionId,
      }),
    );

    // The workflow is what owns the CSV, so the upload is made READY before it starts.
    await this.files.claimUploads([input.fileId], 'BULK_IMPORT_CSV');

    const address = this.config.get<string>('TEMPORAL_ADDRESS', 'localhost:7233');
    const connection = await Connection.connect({ address });
    const client = new Client({ connection });

    // Random, so an import's id cannot be guessed from when it started.
    const workflowId = tenantWorkflowId(WORKFLOW_KIND, input.tenantId, randomUUID());

    await client.workflow.start('BulkStudentImportWorkflow', {
      taskQueue: TASK_QUEUE,
      workflowId,
      workflowExecutionTimeout: '10 minutes',
      args: [input],
    });

    this.logger.log(`Started bulk import workflow: ${workflowId}`);
    await connection.close();

    return workflowId;
  }

  /**
   * Query the progress of a running or completed bulk import workflow.
   * Uses the Temporal query API to read the workflow's progress state.
   */
  async getProgress(tenantId: string, workflowId: string): Promise<BulkImportProgress> {
    // A workflow id names its institute; another institute's import does not exist for the caller.
    if (!isTenantWorkflowId(workflowId, WORKFLOW_KIND, tenantId)) {
      throw new BusinessException(ErrorCode.NOT_FOUND, 'Import not found');
    }
    const address = this.config.get<string>('TEMPORAL_ADDRESS', 'localhost:7233');
    const connection = await Connection.connect({ address });
    const client = new Client({ connection });

    try {
      const handle = client.workflow.getHandle(workflowId);

      // Try query first (works while workflow is running)
      try {
        const progress = await handle.query<BulkImportProgress>('bulkImportProgress');
        return progress;
      } catch {
        // Query failed — workflow may have completed. Check result.
        const description = await handle.describe();

        if (description.status.name === 'COMPLETED') {
          const result = (await handle.result()) as BulkStudentImportResult;
          return {
            status: 'completed',
            totalRows: result.totalRows,
            processed: result.totalRows,
            created: result.created,
            skipped: result.skipped,
            errorCount: result.errorCount,
            reportFileId: result.reportFileId,
          };
        }

        if (description.status.name === 'FAILED') {
          return {
            status: 'failed',
            totalRows: 0,
            processed: 0,
            created: 0,
            skipped: 0,
            errorCount: 0,
            reportFileId: null,
          };
        }

        // Still running but query not yet available
        return {
          status: 'parsing',
          totalRows: 0,
          processed: 0,
          created: 0,
          skipped: 0,
          errorCount: 0,
          reportFileId: null,
        };
      }
    } finally {
      await connection.close();
    }
  }
}
