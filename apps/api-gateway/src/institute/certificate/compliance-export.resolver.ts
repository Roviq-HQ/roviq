import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import {
  assertTenantContext,
  CurrentUser,
  GqlAuthGuard,
  InstituteScopeGuard,
} from '@roviq/auth-backend';
import { AbilityGuard, CheckAbility } from '@roviq/casl';
import type { AuthUser } from '@roviq/common-types';
import { ComplianceExportService } from './compliance-export.service';
import { ExportComplianceReportInput } from './dto/export-report.input';
import { ExportReportModel } from './models/export-report.model';
import type { ExportReportRecord } from './repositories/types';

@UseGuards(GqlAuthGuard, InstituteScopeGuard, AbilityGuard)
@Resolver()
export class ComplianceExportResolver {
  constructor(private readonly exports: ComplianceExportService) {}

  @Mutation(() => ExportReportModel, {
    description:
      'Start a compliance export of your institute. Returns the PENDING export; poll `listExportReports` until it is COMPLETED or FAILED.',
  })
  @CheckAbility({ action: 'manage', subject: 'Export' })
  async exportComplianceReport(
    @Args('input') input: ExportComplianceReportInput,
    @CurrentUser() user: AuthUser,
  ): Promise<ExportReportRecord> {
    assertTenantContext(user);
    return this.exports.requestForInstitute(user, input);
  }

  @Query(() => [ExportReportModel], {
    description:
      'Past compliance exports of your institute, newest first (last 50). Download a COMPLETED file with `fileDownloadUrl`.',
  })
  @CheckAbility({ action: 'read', subject: 'Export' })
  async listExportReports(@CurrentUser() user: AuthUser): Promise<ExportReportRecord[]> {
    assertTenantContext(user);
    return this.exports.list(user, user.tenantId);
  }
}
