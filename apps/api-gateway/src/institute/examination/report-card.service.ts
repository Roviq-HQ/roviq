import { Injectable } from '@nestjs/common';
import { BusinessException, ErrorCode } from '@roviq/common-types';
import { ReportCardGenerationService } from './report-card-generation.service';
import { ExaminationRepository } from './repositories/examination.repository';
import type {
  CreateReportCardData,
  ReportCardInstanceRecord,
  ReportCardRecord,
} from './repositories/types';

/** Report-card config CRUD + generate/publish orchestration + instance reads. */
@Injectable()
export class ReportCardService {
  constructor(
    private readonly repo: ExaminationRepository,
    private readonly generation: ReportCardGenerationService,
  ) {}

  createReportCard(data: CreateReportCardData): Promise<ReportCardRecord> {
    return this.repo.createReportCard(data);
  }

  updateReportCard(id: string, data: Partial<CreateReportCardData>): Promise<ReportCardRecord> {
    return this.repo.updateReportCard(id, data);
  }

  listReportCards(academicYearId: string): Promise<ReportCardRecord[]> {
    return this.repo.listReportCards(academicYearId);
  }

  async getReportCard(id: string): Promise<ReportCardRecord> {
    const card = await this.repo.findReportCardById(id);
    if (!card) throw new BusinessException(ErrorCode.REPORT_CARD_NOT_FOUND, `Report card ${id}`);
    return card;
  }

  deleteReportCard(id: string): Promise<void> {
    return this.repo.softDeleteReportCard(id);
  }

  /** Compute (or recompute) per-student instances for a section. */
  generate(reportCardId: string, sectionId: string): Promise<ReportCardInstanceRecord[]> {
    return this.generation.generate(reportCardId, sectionId);
  }

  /** Release all generated instances to students/parents. Returns the count. */
  publish(reportCardId: string): Promise<number> {
    return this.generation.publish(reportCardId);
  }

  listInstances(reportCardId: string): Promise<ReportCardInstanceRecord[]> {
    return this.repo.listReportCardInstances(reportCardId);
  }

  async getInstance(
    reportCardId: string,
    studentProfileId: string,
  ): Promise<ReportCardInstanceRecord> {
    const inst = await this.repo.findReportCardInstance(reportCardId, studentProfileId);
    if (!inst) throw new BusinessException(ErrorCode.REPORT_CARD_NOT_FOUND, 'Instance not found');
    return inst;
  }

  /** Published report cards for a student (student/parent portal). */
  listForStudent(studentProfileId: string): Promise<ReportCardInstanceRecord[]> {
    return this.repo.listReportCardInstancesByStudent(studentProfileId);
  }

  /** Published report cards for the signed-in student (resolves profile by membership). */
  async listForMembership(membershipId: string): Promise<ReportCardInstanceRecord[]> {
    const profileId = await this.repo.findStudentProfileIdByMembership(membershipId);
    return profileId ? this.repo.listReportCardInstancesByStudent(profileId) : [];
  }
}
