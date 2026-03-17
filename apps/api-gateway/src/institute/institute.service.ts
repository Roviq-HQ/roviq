import { Injectable, NotFoundException } from '@nestjs/common';
import type { CreateInstituteInput } from './dto/create-institute.input';
import type { UpdateInstituteInfoInput } from './dto/update-institute-info.input';
import type { InstituteModel } from './models/institute.model';
import { InstituteRepository } from './repositories/institute.repository';

@Injectable()
export class InstituteService {
  constructor(private readonly instituteRepo: InstituteRepository) {}

  async findById(id: string): Promise<InstituteModel> {
    const record = await this.instituteRepo.findById(id);
    if (!record) {
      throw new NotFoundException(`Institute ${id} not found`);
    }
    return record as unknown as InstituteModel;
  }

  async create(input: CreateInstituteInput): Promise<InstituteModel> {
    const record = await this.instituteRepo.create(input);
    return record as unknown as InstituteModel;
  }

  async updateInfo(id: string, input: UpdateInstituteInfoInput): Promise<InstituteModel> {
    const record = await this.instituteRepo.updateInfo(id, input);
    return record as unknown as InstituteModel;
  }
}
