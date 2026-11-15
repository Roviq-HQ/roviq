import { Injectable } from '@nestjs/common';
import type { InstituteReadAccess } from '@roviq/casl';
import type { ListGuardiansFilterInput } from './dto/list-guardians-filter.input';
import { GuardianReadRepository } from './guardian-read.repository';

@Injectable()
export class GuardianQueryService {
  constructor(private readonly repository: GuardianReadRepository) {}

  findById(id: string, access: InstituteReadAccess) {
    return this.repository.findById(id, access);
  }
  list(filter: ListGuardiansFilterInput, access: InstituteReadAccess) {
    return this.repository.list(filter, access);
  }
  listLinkedStudents(id: string, access: InstituteReadAccess) {
    return this.repository.listLinkedStudents(id, access);
  }
  listForStudent(id: string, access: InstituteReadAccess) {
    return this.repository.listForStudent(id, access);
  }
}
