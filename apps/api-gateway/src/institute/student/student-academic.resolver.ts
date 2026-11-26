import { ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { Args, ID, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { GqlAuthGuard, InstituteScopeGuard } from '@roviq/auth-backend';
import {
  AbilityGuard,
  CheckAbility,
  CurrentReadAccess,
  type InstituteReadAccess,
} from '@roviq/casl';
import { BusinessException, ErrorCode } from '@roviq/common-types';
import { ChangeStudentClassInput } from './dto/change-student-class.input';
import { EnrollStudentInput, UpdateStudentSectionInput } from './dto/enroll-student.input';
import { SetPromotionDecisionsInput } from './dto/set-promotion-decisions.input';
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
  @CheckAbility({ action: 'read', subject: 'Student', rows: 'scoped' })
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

  @Mutation(() => ID, {
    description:
      "Moves a student to another class of the same year, with capacity check; aligns last year's result.",
  })
  @CheckAbility({ action: 'update', subject: 'Student' })
  async changeStudentClass(@Args('input') input: ChangeStudentClassInput): Promise<string> {
    const result = await this.academicService.changeClass(input);
    return result.id;
  }

  @Mutation(() => Boolean, {
    description:
      'Removes a student from one academic year (soft-deletes the year record). Refused with STUDENT_YEAR_HAS_RECORDS once the year holds attendance, marks, assessments or report cards.',
  })
  @CheckAbility({ action: 'update', subject: 'Student' })
  async removeStudentFromYear(
    @Args('studentAcademicId', { type: () => ID }, ParseUUIDPipe) studentAcademicId: string,
    @Args('reason', { description: '3 to 500 characters after trimming.' }) reason: string,
  ): Promise<boolean> {
    await this.academicService.removeFromYear(studentAcademicId, reason);
    return true;
  }

  @Mutation(() => Int, {
    description:
      'Records the year-end result on student year records; returns how many were updated. Applied at the next year activation.',
  })
  @CheckAbility({ action: 'update', subject: 'Student' })
  async setPromotionDecisions(@Args('input') input: SetPromotionDecisionsInput): Promise<number> {
    return this.academicService.setPromotionDecisions(input);
  }
}
