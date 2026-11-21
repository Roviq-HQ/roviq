import { Parent, ResolveField, Resolver } from '@nestjs/graphql';
import { FileLoaders } from '../../files/file.loaders';
import { FileRefModel } from '../../files/models/file-ref.model';
import type { FileRecord } from '../../files/repositories/types';
import { CertificateModel, TCModel } from './models/tc.model';

const PDF_DESCRIPTION =
  'The rendered PDF once issued. Sensitive: `url` is null; download through `fileDownloadUrl`.';

// Field-only: the queries and mutations that return the parent have run their own guards.
@Resolver(() => TCModel)
export class TcPdfResolver {
  constructor(private readonly loaders: FileLoaders) {}

  @ResolveField(() => FileRefModel, { nullable: true, description: PDF_DESCRIPTION })
  pdf(@Parent() tc: TCModel): Promise<FileRecord | null> {
    return tc.pdfFileId ? this.loaders.readyById.load(tc.pdfFileId) : Promise.resolve(null);
  }
}

@Resolver(() => CertificateModel)
export class CertificatePdfResolver {
  constructor(private readonly loaders: FileLoaders) {}

  @ResolveField(() => FileRefModel, { nullable: true, description: PDF_DESCRIPTION })
  pdf(@Parent() certificate: CertificateModel): Promise<FileRecord | null> {
    return certificate.pdfFileId
      ? this.loaders.readyById.load(certificate.pdfFileId)
      : Promise.resolve(null);
  }
}
