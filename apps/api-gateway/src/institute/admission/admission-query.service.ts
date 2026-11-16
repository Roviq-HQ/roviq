import { Injectable } from '@nestjs/common';
import { AbilityFactory, type AbilityRequestContext, type InstituteReadAccess } from '@roviq/casl';
import { AdmissionReadRepository } from './admission-read.repository';
import type { AdmissionStatisticsFilterInput } from './dto/admission-statistics-filter.input';
import type { ApplicationFilterInput, EnquiryFilterInput } from './dto/enquiry-filter.input';

@Injectable()
export class AdmissionQueryService {
  constructor(
    private readonly repository: AdmissionReadRepository,
    private readonly abilities: AbilityFactory,
  ) {}
  listEnquiries(filter: EnquiryFilterInput, access: InstituteReadAccess) {
    return this.repository.listEnquiries(filter, access);
  }
  listApplications(filter: ApplicationFilterInput, access: InstituteReadAccess) {
    return this.repository.listApplications(filter, access);
  }
  getApplication(id: string, access: InstituteReadAccess) {
    return this.repository.getApplication(id, access);
  }
  statistics(access: InstituteReadAccess, filter?: AdmissionStatisticsFilterInput) {
    return this.repository.statistics(access, filter);
  }
  async filterEvent(
    id: string,
    subject: 'Enquiry' | 'Application',
    context: AbilityRequestContext,
  ) {
    if (context.req.user.scope !== 'institute') return false;
    const ability = await this.abilities.createForUser(context.req.user);
    context.req.ability = ability;
    return this.repository.isVisible(id, subject, { user: context.req.user, ability });
  }
}
