import { Injectable, NotFoundException } from '@nestjs/common';
import { BusinessException, ErrorCode } from '@roviq/common-types';
import { EventBusService } from '@roviq/event-bus';
import { EVENT_PATTERNS } from '@roviq/nats-jetstream';
import { AcademicYearRepository } from '../../academic-year/repositories/academic-year.repository';
import type { CreateStandardInput } from './dto/create-standard.input';
import type { UpdateStandardInput } from './dto/update-standard.input';
import { StandardRepository } from './repositories/standard.repository';
import type { StandardRecord } from './repositories/types';

@Injectable()
export class StandardService {
  constructor(
    private readonly repo: StandardRepository,
    private readonly academicYearRepo: AcademicYearRepository,
    private readonly eventBus: EventBusService,
  ) {}

  async findById(id: string): Promise<StandardRecord> {
    const record = await this.repo.findById(id);
    if (!record) throw new NotFoundException(`Standard ${id} not found`);
    return record;
  }

  async findByAcademicYear(academicYearId?: string | null): Promise<StandardRecord[]> {
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

  async create(input: CreateStandardInput): Promise<StandardRecord> {
    const record = await this.repo.create(input);

    this.eventBus.emit(EVENT_PATTERNS.STANDARD.created, {
      standardId: record.id,
      tenantId: record.tenantId,
      name: record.name,
    });

    return record;
  }

  async update(id: string, input: UpdateStandardInput): Promise<StandardRecord> {
    const record = await this.repo.update(id, input);

    this.eventBus.emit(EVENT_PATTERNS.STANDARD.updated, {
      standardId: record.id,
      tenantId: record.tenantId,
    });

    return record;
  }

  async delete(id: string): Promise<boolean> {
    const existing = await this.findById(id);
    await this.repo.softDelete(id);

    this.eventBus.emit(EVENT_PATTERNS.STANDARD.deleted, {
      standardId: id,
      tenantId: existing.tenantId,
    });

    return true;
  }
}
