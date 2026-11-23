/**
 * Staff qualification service — structured CRUD for `staff_qualifications`.
 *
 * Queries live in `StaffQualificationRepository`, which runs them under the
 * institute's tenant context so RLS enforces isolation.
 */

import { Injectable } from '@nestjs/common';
import { BusinessException, ErrorCode } from '@roviq/common-types';
import { getRequestContext } from '@roviq/request-context';
import { FileService } from '../../files/file.service';
import type { CreateStaffQualificationInput } from './dto/create-staff-qualification.input';
import type { UpdateStaffQualificationInput } from './dto/update-staff-qualification.input';
import { StaffQualificationRepository } from './repositories/staff-qualification.repository';
import type { StaffQualificationPatch } from './repositories/staff-qualification.types';
import { qualificationNotFound } from './staff-qualification.errors';

const CERTIFICATE_PURPOSE = 'STAFF_CERTIFICATE';

@Injectable()
export class StaffQualificationService {
  constructor(
    private readonly repo: StaffQualificationRepository,
    private readonly files: FileService,
  ) {}

  private get tenantId(): string {
    const { tenantId } = getRequestContext();
    if (!tenantId) throw new Error('Tenant context required');
    return tenantId;
  }

  /** Returns qualifications for a staff profile, newest-first on year. */
  async listForStaff(staffProfileId: string) {
    return this.repo.listForStaff(this.tenantId, staffProfileId);
  }

  async create(input: CreateStaffQualificationInput) {
    const tenantId = this.tenantId;
    const actorId = getRequestContext().userId;
    const certificateFileId = input.certificateFileId ?? null;

    const staffExists = await this.repo.staffExists(tenantId, input.staffProfileId);
    if (!staffExists)
      throw new BusinessException(ErrorCode.STAFF_NOT_FOUND, 'Staff member not found');
    if (certificateFileId) await this.files.verifyUploads([certificateFileId], CERTIFICATE_PURPOSE);

    return this.repo.create({
      tenantId,
      actorId,
      staffProfileId: input.staffProfileId,
      type: input.type,
      degreeName: input.degreeName,
      institution: input.institution ?? null,
      boardUniversity: input.boardUniversity ?? null,
      yearOfPassing: input.yearOfPassing ?? null,
      gradePercentage: input.gradePercentage ?? null,
      certificateFileId,
    });
  }

  async update(id: string, input: UpdateStaffQualificationInput) {
    const actorId = getRequestContext().userId;
    const tenantId = this.tenantId;

    const existing = await this.findLive(tenantId, id);
    // Undefined keeps the scan, null removes it, an id replaces it.
    const replacesCertificate =
      input.certificateFileId !== undefined &&
      input.certificateFileId !== existing.certificateFileId;
    const newFileId = replacesCertificate ? (input.certificateFileId ?? null) : null;
    if (newFileId) await this.files.verifyUploads([newFileId], CERTIFICATE_PURPOSE);

    const patch: StaffQualificationPatch = {};
    if (input.type !== undefined) patch.type = input.type;
    if (input.degreeName !== undefined) patch.degreeName = input.degreeName;
    if (input.institution !== undefined) patch.institution = input.institution;
    if (input.boardUniversity !== undefined) patch.boardUniversity = input.boardUniversity;
    if (input.yearOfPassing !== undefined) patch.yearOfPassing = input.yearOfPassing;
    if (input.gradePercentage !== undefined) patch.gradePercentage = input.gradePercentage;

    return this.repo.update(
      tenantId,
      id,
      actorId,
      patch,
      replacesCertificate ? { newFileId, previousFileId: existing.certificateFileId } : null,
    );
  }

  async delete(id: string): Promise<boolean> {
    const actorId = getRequestContext().userId;
    const tenantId = this.tenantId;
    const existing = await this.findLive(tenantId, id);
    await this.repo.softDelete(tenantId, id, actorId, existing.certificateFileId);
    return true;
  }

  private async findLive(tenantId: string, id: string) {
    const row = await this.repo.findLive(tenantId, id);
    if (!row) throw qualificationNotFound(id);
    return row;
  }
}
