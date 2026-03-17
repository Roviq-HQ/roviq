import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { CreateAcademicYearInput } from './dto/create-academic-year.input';
import type { UpdateAcademicYearInput } from './dto/update-academic-year.input';
import type { AcademicYearModel } from './models/academic-year.model';
import { AcademicYearRepository } from './repositories/academic-year.repository';

const STATUS_TRANSITIONS: Record<string, string[]> = {
  PLANNING: ['ACTIVE'],
  ACTIVE: ['COMPLETING'],
  COMPLETING: ['ARCHIVED'],
};

@Injectable()
export class AcademicYearService {
  constructor(private readonly repo: AcademicYearRepository) {}

  async findById(id: string): Promise<AcademicYearModel> {
    const record = await this.repo.findById(id);
    if (!record) throw new NotFoundException(`Academic year ${id} not found`);
    return record as unknown as AcademicYearModel;
  }

  async findAll(): Promise<AcademicYearModel[]> {
    const records = await this.repo.findAll();
    return records as unknown as AcademicYearModel[];
  }

  async findActive(): Promise<AcademicYearModel | null> {
    const record = await this.repo.findActive();
    return record as unknown as AcademicYearModel | null;
  }

  async create(input: CreateAcademicYearInput): Promise<AcademicYearModel> {
    const record = await this.repo.create(input);
    return record as unknown as AcademicYearModel;
  }

  async update(id: string, input: UpdateAcademicYearInput): Promise<AcademicYearModel> {
    const existing = await this.repo.findById(id);
    if (!existing) throw new NotFoundException(`Academic year ${id} not found`);
    if (existing.status === 'ARCHIVED') {
      throw new BadRequestException('Cannot modify an archived academic year');
    }
    const record = await this.repo.update(id, input);
    return record as unknown as AcademicYearModel;
  }

  async activate(id: string): Promise<AcademicYearModel> {
    const target = await this.repo.findById(id);
    if (!target) throw new NotFoundException(`Academic year ${id} not found`);

    const allowed = STATUS_TRANSITIONS[target.status];
    if (!allowed?.includes('ACTIVE')) {
      throw new BadRequestException(`Cannot activate from status ${target.status}`);
    }

    // Find current active year to deactivate
    const currentActive = await this.repo.findActive();
    const record = await this.repo.activate(id, currentActive?.id ?? null);
    return record as unknown as AcademicYearModel;
  }

  async archive(id: string): Promise<AcademicYearModel> {
    const existing = await this.repo.findById(id);
    if (!existing) throw new NotFoundException(`Academic year ${id} not found`);

    if (existing.status !== 'COMPLETING') {
      throw new BadRequestException(
        `Cannot archive from status ${existing.status}, must be COMPLETING`,
      );
    }

    const record = await this.repo.updateStatus(id, 'ARCHIVED');
    return record as unknown as AcademicYearModel;
  }
}
