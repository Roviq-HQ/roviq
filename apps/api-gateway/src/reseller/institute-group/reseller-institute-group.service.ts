import { Injectable } from '@nestjs/common';
import type { CreateInstituteGroupInput } from '../../institute/institute-group/dto/create-institute-group.input';
import { InstituteGroupService } from '../../institute/institute-group/institute-group.service';

@Injectable()
export class ResellerInstituteGroupService {
  constructor(private readonly groupService: InstituteGroupService) {}

  async create(resellerId: string, input: CreateInstituteGroupInput) {
    return this.groupService.create(input, resellerId);
  }

  async list(resellerId: string) {
    return this.groupService.searchForReseller(resellerId, {});
  }

  async addInstitute(resellerId: string, instituteId: string, groupId: string) {
    return this.groupService.addInstituteToGroupForReseller(resellerId, instituteId, groupId);
  }

  async removeInstitute(resellerId: string, instituteId: string) {
    return this.groupService.removeInstituteFromGroupForReseller(resellerId, instituteId);
  }
}
