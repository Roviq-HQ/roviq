/**
 * Resolver for bulk student import operations (ROV-155).
 *
 * Mutations:
 * - bulkCreateStudents: starts a Temporal workflow, returns workflowId
 *
 * Queries:
 * - bulkImportProgress: returns current status of an import workflow
 */
import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Parent, Query, ResolveField, Resolver } from '@nestjs/graphql';
import {
  assertTenantContext,
  CurrentUser,
  GqlAuthGuard,
  InstituteScopeGuard,
} from '@roviq/auth-backend';
import { AbilityGuard, CheckAbility } from '@roviq/casl';
import type { AuthUser } from '@roviq/common-types';
import { FileLoaders } from '../../files/file.loaders';
import { FileRefModel } from '../../files/models/file-ref.model';
import type { FileRecord } from '../../files/repositories/types';
import { BulkCreateStudentsInput } from './dto/bulk-create-students.input';
import { BulkImportProgressModel, BulkImportStatusEnum } from './models/bulk-import-progress.model';
import { BulkImportStartResult } from './models/bulk-import-result.model';
import { StudentBulkImportService } from './student-bulk-import.service';

@Resolver()
@UseGuards(GqlAuthGuard, InstituteScopeGuard, AbilityGuard)
export class StudentBulkImportResolver {
  constructor(private readonly importService: StudentBulkImportService) {}

  /**
   * Start a bulk student import from a CSV file.
   * Returns the Temporal workflow ID for progress tracking via bulkImportProgress.
   */
  @Mutation(() => BulkImportStartResult, { description: 'Start bulk student import from CSV' })
  @CheckAbility({ action: 'create', subject: 'Student' })
  async bulkCreateStudents(
    @Args('input') input: BulkCreateStudentsInput,
    @CurrentUser() user: AuthUser,
  ): Promise<BulkImportStartResult> {
    assertTenantContext(user);

    const workflowId = await this.importService.startBulkImport({
      tenantId: user.tenantId,
      fileId: input.fileId,
      academicYearId: input.academicYearId,
      standardId: input.standardId,
      sectionId: input.sectionId,
      createdBy: user.userId,
      fieldMapping: input.fieldMapping,
    });

    return { workflowId };
  }

  /**
   * Get the current progress of a bulk import workflow.
   * Poll this query to track import status.
   */
  @Query(() => BulkImportProgressModel, { description: 'Get bulk import progress by workflow ID' })
  @CheckAbility({ action: 'read', subject: 'Student' })
  async bulkImportProgress(
    @Args('workflowId') workflowId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<BulkImportProgressModel> {
    assertTenantContext(user);
    const progress = await this.importService.getProgress(user.tenantId, workflowId);

    return {
      status: progress.status as BulkImportStatusEnum,
      totalRows: progress.totalRows,
      processed: progress.processed,
      created: progress.created,
      skipped: progress.skipped,
      errors: progress.errorCount,
      reportFileId: progress.reportFileId,
    };
  }
}

@Resolver(() => BulkImportProgressModel)
export class BulkImportReportResolver {
  constructor(private readonly loaders: FileLoaders) {}

  @ResolveField(() => FileRefModel, {
    nullable: true,
    description: 'CSV listing the rows that failed, once the import has completed with errors.',
  })
  report(@Parent() progress: BulkImportProgressModel): Promise<FileRecord | null> {
    return progress.reportFileId
      ? this.loaders.readyById.load(progress.reportFileId)
      : Promise.resolve(null);
  }
}
