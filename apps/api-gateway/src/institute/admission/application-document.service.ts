import { Injectable } from '@nestjs/common';
import type { InstituteReadAccess } from '@roviq/casl';
import type { InstituteContext } from '@roviq/common-types';
import { FileService } from '../../files/file.service';
import {
  APPLICATION_DOCUMENT_PURPOSE,
  type ApplicationDocumentRecord,
  ApplicationDocumentRepository,
} from './application-document.repository';
import type { AddApplicationDocumentInput } from './dto/application-document.input';

@Injectable()
export class ApplicationDocumentService {
  constructor(
    private readonly repository: ApplicationDocumentRepository,
    private readonly files: FileService,
  ) {}

  /** Aadhaar scans follow the same field rule as on a student: they show the number itself. */
  async list(
    applicationId: string,
    access: InstituteReadAccess,
  ): Promise<ApplicationDocumentRecord[]> {
    const documents = await this.repository.list(applicationId, access);
    return documents.filter(
      (document) =>
        document.type !== 'AADHAAR_CARD' || access.ability.can('read', 'Student', 'aadhaar'),
    );
  }

  async add(
    user: InstituteContext,
    input: AddApplicationDocumentInput,
  ): Promise<ApplicationDocumentRecord> {
    // Checked before the uploads are moved into place, and again when the document is saved.
    await this.repository.assertOpenApplication(input.applicationId, user);
    await this.files.verifyUploads(input.fileIds, APPLICATION_DOCUMENT_PURPOSE);
    return this.repository.add(user, input);
  }

  remove(user: InstituteContext, documentId: string): Promise<void> {
    return this.repository.remove(user, documentId);
  }
}
