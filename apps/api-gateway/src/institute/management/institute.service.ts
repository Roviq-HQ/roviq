import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { instituteContactSchema } from '@roviq/database';
import { EventBusService } from '../../common/event-bus.service';
import { encodeCursor } from '../../common/pagination/relay-pagination.model';
import type { CreateInstituteInput } from './dto/create-institute.input';
import type { InstituteFilterInput } from './dto/institute-filter.input';
import type { UpdateInstituteBrandingInput } from './dto/update-institute-branding.input';
import type { UpdateInstituteConfigInput } from './dto/update-institute-config.input';
import type { UpdateInstituteInfoInput } from './dto/update-institute-info.input';
import type { InstituteModel } from './models/institute.model';
import { InstituteRepository } from './repositories/institute.repository';
import type { UpdateInstituteConfigData } from './repositories/types';
import { InstituteSetupService } from './seed/institute-setup.service';

// Valid status transitions: from → [allowed targets]
const STATUS_TRANSITIONS: Record<string, string[]> = {
  PENDING: ['ACTIVE', 'REJECTED'],
  ACTIVE: ['INACTIVE', 'SUSPENDED'],
  INACTIVE: ['ACTIVE'],
  SUSPENDED: ['ACTIVE'],
  // REJECTED is terminal — no transitions out
};

@Injectable()
export class InstituteService {
  private readonly logger = new Logger(InstituteService.name);

  constructor(
    private readonly instituteRepo: InstituteRepository,
    private readonly setupService: InstituteSetupService,
    private readonly eventBus: EventBusService,
  ) {}

  private emitEvent(pattern: string, data: Record<string, unknown>) {
    this.eventBus.emit(pattern, data);
  }

  async search(filter: InstituteFilterInput) {
    const { records, total } = await this.instituteRepo.search({
      search: filter.search,
      status: filter.status,
      type: filter.type,
      first: (filter.first ?? 20) + 1, // Fetch one extra to determine hasNextPage
      after: filter.after,
    });

    const limit = filter.first ?? 20;
    const hasNextPage = records.length > limit;
    const nodes = hasNextPage ? records.slice(0, limit) : records;

    const edges = nodes.map((record) => ({
      node: record as unknown as InstituteModel,
      cursor: encodeCursor({ id: record.id }),
    }));

    return {
      edges,
      pageInfo: {
        hasNextPage,
        hasPreviousPage: !!filter.after,
        startCursor: edges[0]?.cursor,
        endCursor: edges[edges.length - 1]?.cursor,
      },
      totalCount: total,
    };
  }

  async findById(id: string): Promise<InstituteModel> {
    const record = await this.instituteRepo.findById(id);
    if (!record) {
      throw new NotFoundException(`Institute ${id} not found`);
    }
    return record as unknown as InstituteModel;
  }

  async create(input: CreateInstituteInput): Promise<InstituteModel> {
    const record = await this.instituteRepo.create(input);
    const institute = record as unknown as InstituteModel;

    // Trigger async setup — runs synchronously for now, will be Temporal workflow later
    this.setupService
      .runSetup({
        instituteId: institute.id,
        type: input.type ?? 'SCHOOL',
        departments: input.departments ?? [
          'PRIMARY',
          'UPPER_PRIMARY',
          'SECONDARY',
          'SENIOR_SECONDARY',
        ],
        board: input.board,
        isDemo: input.isDemo,
      })
      .catch((err) => {
        this.logger.error(`Setup failed for institute ${institute.id}`, err);
      });

    this.emitEvent('INSTITUTE.created', { instituteId: institute.id, type: input.type });

    return institute;
  }

  async updateInfo(id: string, input: UpdateInstituteInfoInput): Promise<InstituteModel> {
    if (input.contact) {
      const result = instituteContactSchema.safeParse(input.contact);
      if (!result.success) {
        throw new BadRequestException(result.error.message);
      }
    }

    const record = await this.instituteRepo.updateInfo(id, input);
    return record as unknown as InstituteModel;
  }

  async updateBranding(
    instituteId: string,
    input: UpdateInstituteBrandingInput,
  ): Promise<InstituteModel> {
    const record = await this.instituteRepo.updateBranding(instituteId, input);
    this.emitEvent('INSTITUTE.branding_updated', { instituteId, branding: input });
    return record as unknown as InstituteModel;
  }

  async updateConfig(
    instituteId: string,
    input: UpdateInstituteConfigInput,
  ): Promise<InstituteModel> {
    const record = await this.instituteRepo.updateConfig(
      instituteId,
      input as UpdateInstituteConfigData,
    );
    this.emitEvent('INSTITUTE.config_updated', {
      instituteId,
      changedFields: Object.keys(input),
    });
    return record as unknown as InstituteModel;
  }

  async activate(id: string): Promise<InstituteModel> {
    const institute = await this.requireInstitute(id);
    this.validateTransition(institute.status, 'ACTIVE');

    if (institute.setupStatus !== 'COMPLETED') {
      throw new BadRequestException(
        `Cannot activate institute: setup_status is ${institute.setupStatus}, must be COMPLETED`,
      );
    }

    const record = await this.instituteRepo.updateStatus(id, 'ACTIVE');

    this.emitEvent('INSTITUTE.activated', { instituteId: id, previousStatus: institute.status });

    return record as unknown as InstituteModel;
  }

  async deactivate(id: string): Promise<InstituteModel> {
    const institute = await this.requireInstitute(id);
    this.validateTransition(institute.status, 'INACTIVE');
    const record = await this.instituteRepo.updateStatus(id, 'INACTIVE');

    this.emitEvent('INSTITUTE.deactivated', { instituteId: id, previousStatus: institute.status });

    return record as unknown as InstituteModel;
  }

  async suspend(id: string): Promise<InstituteModel> {
    const institute = await this.requireInstitute(id);
    this.validateTransition(institute.status, 'SUSPENDED');
    const record = await this.instituteRepo.updateStatus(id, 'SUSPENDED');

    this.emitEvent('INSTITUTE.suspended', { instituteId: id, previousStatus: institute.status });

    return record as unknown as InstituteModel;
  }

  async reject(id: string): Promise<InstituteModel> {
    const institute = await this.requireInstitute(id);
    this.validateTransition(institute.status, 'REJECTED');
    const record = await this.instituteRepo.updateStatus(id, 'REJECTED');

    this.emitEvent('INSTITUTE.rejected', { instituteId: id, previousStatus: institute.status });

    return record as unknown as InstituteModel;
  }

  async delete(id: string): Promise<boolean> {
    await this.requireInstitute(id);
    await this.instituteRepo.softDelete(id);

    this.emitEvent('INSTITUTE.deleted', { instituteId: id });

    return true;
  }

  async restore(id: string): Promise<InstituteModel> {
    const record = await this.instituteRepo.restore(id);

    this.emitEvent('INSTITUTE.restored', { instituteId: id });

    return record as unknown as InstituteModel;
  }

  private async requireInstitute(id: string) {
    const record = await this.instituteRepo.findById(id);
    if (!record) {
      throw new NotFoundException(`Institute ${id} not found`);
    }
    return record;
  }

  private validateTransition(currentStatus: string, targetStatus: string): void {
    const allowed = STATUS_TRANSITIONS[currentStatus];
    if (!allowed || !allowed.includes(targetStatus)) {
      throw new BadRequestException(`Cannot transition from ${currentStatus} to ${targetStatus}`);
    }
  }
}
