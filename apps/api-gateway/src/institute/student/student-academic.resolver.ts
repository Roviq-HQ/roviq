import { UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { GqlAuthGuard, InstituteScopeGuard } from '@roviq/auth-backend';
import {
  AbilityGuard,
  CheckAbility,
  CurrentReadAccess,
  type InstituteReadAccess,
} from '@roviq/casl';
import { BusinessException, ErrorCode } from '@roviq/common-types';
import { EnrollStudentInput, UpdateStudentSectionInput } from './dto/enroll-student.input';
import { StudentAcademicHistoryModel } from './models/student-academic-history.model';
import { StudentAcademicService } from './student-academic.service';
import { StudentQueryService } from './student-query.service';

@UseGuards(GqlAuthGuard, InstituteScopeGuard, AbilityGuard)
@Resolver()
export class StudentAcademicResolver {
  constructor(
    private readonly academicService: StudentAcademicService,
    private readonly students: StudentQueryService,
  ) {}

  @Query(() => [StudentAcademicHistoryModel], {
    description:
      'Year-by-year academic history for a single student (Academics tab on detail page).',
  })
  @CheckAbility({ action: 'read', subject: 'Student' })
  async listStudentAcademics(
    @Args('studentProfileId', { type: () => ID }) studentProfileId: string,
    @CurrentReadAccess() access: InstituteReadAccess,
  ): Promise<StudentAcademicHistoryModel[]> {
    await this.students.findById(studentProfileId, access);
    if (!access.ability.can('read', 'Student', 'currentSectionId'))
      throw new BusinessException(ErrorCode.FORBIDDEN, 'Cannot read academic history');
    return this.academicService.listForStudent(studentProfileId);
  }

  @Mutation(() => ID, { description: 'Enroll a student in a section with capacity check' })
  @CheckAbility({ action: 'create', subject: 'Student' })
  async enrollStudent(@Args('input') input: EnrollStudentInput): Promise<string> {
    const result = await this.academicService.enroll(input);
    return result.id;
  }

  @Mutation(() => ID, { description: 'Change student section with capacity check' })
  @CheckAbility({ action: 'update', subject: 'Student' })
  async updateStudentSection(@Args('input') input: UpdateStudentSectionInput): Promise<string> {
    const result = await this.academicService.changeSection(input);
    return result.id;
  }
}
