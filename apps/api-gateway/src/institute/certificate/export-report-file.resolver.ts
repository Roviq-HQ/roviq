import { Parent, ResolveField, Resolver } from '@nestjs/graphql';
import { FileLoaders } from '../../files/file.loaders';
import { FileRefModel } from '../../files/models/file-ref.model';
import type { FileRecord } from '../../files/repositories/types';
import { ExportReportModel } from './models/export-report.model';

// Field-only: serves both the institute and the admin export lists, whose own guards have run.
@Resolver(() => ExportReportModel)
export class ExportReportFileResolver {
  constructor(private readonly loaders: FileLoaders) {}

  @ResolveField(() => FileRefModel, {
    nullable: true,
    description:
      'The XLSX once COMPLETED. Sensitive: `url` is null; download through `fileDownloadUrl` (institute) or `adminExportReportDownloadUrl` (platform).',
  })
  file(@Parent() report: ExportReportModel): Promise<FileRecord | null> {
    return report.fileId ? this.loaders.readyById.load(report.fileId) : Promise.resolve(null);
  }
}
