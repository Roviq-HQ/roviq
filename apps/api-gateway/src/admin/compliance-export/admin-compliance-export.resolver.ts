import { ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { assertPlatformContext, CurrentUser, PlatformScope } from '@roviq/auth-backend';
import { AbilityGuard, CheckAbility } from '@roviq/casl';
import type { AuthUser } from '@roviq/common-types';
import { ComplianceExportService } from '../../institute/certificate/compliance-export.service';
import { AdminExportComplianceReportInput } from '../../institute/certificate/dto/export-report.input';
import {
  ExportAcademicYearModel,
  ExportReportModel,
} from '../../institute/certificate/models/export-report.model';
import type {
  ExportAcademicYearRecord,
  ExportReportRecord,
} from '../../institute/certificate/repositories/types';

@PlatformScope()
@Resolver()
export class AdminComplianceExportResolver {
  constructor(private readonly exports: ComplianceExportService) {}

  @Mutation(() => ExportReportModel, {
    description:
      'Start a compliance export of any institute (platform admin). Returns the PENDING export; poll `adminListExportReports` until it is COMPLETED or FAILED.',
  })
  @UseGuards(AbilityGuard)
  @CheckAbility({ action: 'manage', subject: 'Export' })
  async adminExportComplianceReport(
    @Args('input') input: AdminExportComplianceReportInput,
    @CurrentUser() user: AuthUser,
  ): Promise<ExportReportRecord> {
    assertPlatformContext(user);
    return this.exports.requestAsAdmin(user, input);
  }

  @Query(() => [ExportReportModel], {
    description: 'Past compliance exports of one institute, newest first (last 50).',
  })
  @UseGuards(AbilityGuard)
  @CheckAbility({ action: 'read', subject: 'Export' })
  async adminListExportReports(
    @Args('instituteId', { type: () => ID }, ParseUUIDPipe) instituteId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<ExportReportRecord[]> {
    assertPlatformContext(user);
    return this.exports.list(user, instituteId);
  }

  @Query(() => [ExportAcademicYearModel], {
    description: 'Academic years of one institute, newest first, to pick the year of an export.',
  })
  @UseGuards(AbilityGuard)
  @CheckAbility({ action: 'read', subject: 'Export' })
  async adminListExportAcademicYears(
    @Args('instituteId', { type: () => ID }, ParseUUIDPipe) instituteId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<ExportAcademicYearRecord[]> {
    assertPlatformContext(user);
    return this.exports.listAcademicYears(user, instituteId);
  }

  @Mutation(() => String, {
    description:
      'Get a download URL for a COMPLETED export file, valid for 60 seconds. A mutation, so every call is audited.',
  })
  @UseGuards(AbilityGuard)
  @CheckAbility({ action: 'read', subject: 'Export' })
  async adminExportReportDownloadUrl(
    @Args('fileId', { type: () => ID }, ParseUUIDPipe) fileId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<string> {
    assertPlatformContext(user);
    return this.exports.adminDownloadUrl(user, fileId);
  }
}
