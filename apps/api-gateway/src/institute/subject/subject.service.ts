import { Injectable, NotFoundException } from '@nestjs/common';
import { BusinessException, ErrorCode } from '@roviq/common-types';
import { EventBusService } from '@roviq/event-bus';
import { EVENT_PATTERNS } from '@roviq/nats-jetstream';
import { getRequestContext } from '@roviq/request-context';
import { AcademicYearRepository } from '../../academic-year/repositories/academic-year.repository';
import type { CreateSubjectInput } from './dto/create-subject.input';
import type { UpdateSubjectInput } from './dto/update-subject.input';
import { SubjectRepository } from './repositories/subject.repository';
import type { SubjectNameOption, SubjectRecord } from './repositories/types';

@Injectable()
export class SubjectService {
  constructor(
    private readonly repo: SubjectRepository,
    private readonly eventBus: EventBusService,
    private readonly academicYearRepo: AcademicYearRepository,
  ) {}

  private get tenantId(): string {
    const { tenantId } = getRequestContext();
    if (!tenantId) throw new Error('Tenant context required');
    return tenantId;
  }

  async findById(id: string): Promise<SubjectRecord> {
    const record = await this.repo.findById(id);
    if (!record) throw new NotFoundException(`Subject ${id} not found`);
    return record;
  }

  async findAll(): Promise<SubjectRecord[]> {
    return this.repo.findAll();
  }

  async findByStandard(standardId: string): Promise<SubjectRecord[]> {
    return this.repo.findByStandard(standardId);
  }

  async findByAcademicYear(academicYearId?: string | null): Promise<SubjectNameOption[]> {
    return this.repo.findByAcademicYear(await this.resolveAcademicYearId(academicYearId));
  }

  // An omitted year means the current session: the single ACTIVE year.
  // Explicit years stay for planning flows working on non-active years.
  private async resolveAcademicYearId(academicYearId?: string | null): Promise<string> {
    if (academicYearId) return academicYearId;
    const active = await this.academicYearRepo.findActive();
    if (!active) {
      throw new BusinessException(
        ErrorCode.NO_ACTIVE_ACADEMIC_YEAR,
        'No academic year is currently active for this institute',
      );
    }
    return active.id;
  }

  async create(input: CreateSubjectInput): Promise<SubjectRecord> {
    const record = await this.repo.create(input);
    this.eventBus.emit(EVENT_PATTERNS.SUBJECT.created, {
      subjectId: record.id,
      tenantId: record.tenantId,
      name: record.name,
    });
    return record;
  }

  async update(id: string, input: UpdateSubjectInput): Promise<SubjectRecord> {
    const record = await this.repo.update(id, input);
    // SS-001: emit on update so cache/search consumers see metadata changes
    // (the create / delete / assign mutations were already emitting).
    this.eventBus.emit(EVENT_PATTERNS.SUBJECT.updated, {
      subjectId: record.id,
      tenantId: record.tenantId,
      name: record.name,
    });
    return record;
  }

  async delete(id: string): Promise<boolean> {
    await this.repo.softDelete(id);
    // HL-009: include tenantId on delete events for consistent multi-tenant
    // routing — consumers shouldn't have to look up the row to find it.
    this.eventBus.emit(EVENT_PATTERNS.SUBJECT.deleted, { subjectId: id, tenantId: this.tenantId });
    return true;
  }

  async assignToStandard(subjectId: string, standardId: string): Promise<boolean> {
    await this.repo.assignToStandard(subjectId, standardId);
    this.eventBus.emit(EVENT_PATTERNS.SUBJECT.assigned_to_standard, {
      subjectId,
      standardId,
      tenantId: this.tenantId,
    });
    return true;
  }

  async removeFromStandard(subjectId: string, standardId: string): Promise<boolean> {
    await this.repo.removeFromStandard(subjectId, standardId);
    this.eventBus.emit(EVENT_PATTERNS.SUBJECT.removed_from_standard, {
      subjectId,
      standardId,
      tenantId: this.tenantId,
    });
    return true;
  }

  async assignToSection(subjectId: string, sectionId: string): Promise<boolean> {
    await this.repo.assignToSection(subjectId, sectionId);
    this.eventBus.emit(EVENT_PATTERNS.SUBJECT.assigned_to_section, {
      subjectId,
      sectionId,
      tenantId: this.tenantId,
    });
    return true;
  }

  async removeFromSection(subjectId: string, sectionId: string): Promise<boolean> {
    await this.repo.removeFromSection(subjectId, sectionId);
    this.eventBus.emit(EVENT_PATTERNS.SUBJECT.removed_from_section, {
      subjectId,
      sectionId,
      tenantId: this.tenantId,
    });
    return true;
  }
}
