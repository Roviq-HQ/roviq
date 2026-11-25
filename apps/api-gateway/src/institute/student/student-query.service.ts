import { Injectable } from '@nestjs/common';
import { AbilityFactory, type AbilityRequestContext, type InstituteReadAccess } from '@roviq/casl';
import { BusinessException, ErrorCode } from '@roviq/common-types';
import type { StudentFilterInput } from './dto/student-filter.input';
import { StudentReadRepository } from './student-read.repository';

@Injectable()
export class StudentQueryService {
  constructor(
    private readonly repository: StudentReadRepository,
    private readonly abilities: AbilityFactory,
  ) {}

  findById(id: string, access: InstituteReadAccess) {
    return this.repository.findById(id, access);
  }

  list(filter: StudentFilterInput, access: InstituteReadAccess) {
    const filters = [
      [filter.gender, 'gender'],
      [filter.academicStatus, 'academicStatus'],
      [filter.academicYearId, 'currentAcademicYearId'],
      [filter.notPlacedInYearId, 'currentAcademicYearId'],
      [filter.search, 'admissionNumber'],
      [filter.socialCategory, 'socialCategory'],
      [filter.isRteAdmitted, 'isRteAdmitted'],
      [filter.sectionId, 'currentSectionId'],
      [filter.standardId, 'currentStandardId'],
      [filter.membershipId, 'membershipId'],
    ] as const;
    for (const [value, field] of filters) {
      if (value !== undefined && !access.ability.can('read', 'Student', field)) {
        throw new BusinessException(
          ErrorCode.FORBIDDEN,
          'Cannot filter students by a restricted field',
        );
      }
    }
    if (filter.notPlacedInYearId && filter.academicYearId) {
      throw new BusinessException(
        ErrorCode.VALIDATION_FAILED,
        'notPlacedInYearId cannot be combined with academicYearId',
      );
    }
    if (filter.orderBy) {
      const field = filter.orderBy.split(':')[0];
      if (field && !access.ability.can('read', 'Student', field)) {
        throw new BusinessException(
          ErrorCode.FORBIDDEN,
          'Cannot sort students by a restricted field',
        );
      }
    }
    return this.repository.list(filter, access);
  }

  statistics(access: InstituteReadAccess) {
    return this.repository.statistics(access);
  }

  listDocumentsForStudent(id: string, access: InstituteReadAccess) {
    if (!access.ability.can('read', 'Student', 'documents')) {
      throw new BusinessException(ErrorCode.FORBIDDEN, 'Cannot read student documents');
    }
    return this.repository.listDocumentsForStudent(id, access);
  }

  async filterEvent(id: string, context: AbilityRequestContext) {
    if (context.req.user.scope !== 'institute') return false;
    const ability = await this.abilities.createForUser(context.req.user);
    context.req.ability = ability;
    return this.repository.isVisible(id, { user: context.req.user, ability });
  }
}
