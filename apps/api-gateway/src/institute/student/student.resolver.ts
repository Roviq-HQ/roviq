import { UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Query, Resolver, Subscription } from '@nestjs/graphql';
import { GqlAuthGuard, InstituteScopeGuard } from '@roviq/auth-backend';
import {
  AbilityGuard,
  type AbilityRequestContext,
  CheckAbility,
  CurrentReadAccess,
  type InstituteReadAccess,
} from '@roviq/casl';
import { AcademicStatus } from '@roviq/common-types';
import { DeletedPersonModel } from '../../common/deleted-person.model';
import { pubSub } from '../../common/pubsub';
import { CreateStudentInput } from './dto/create-student.input';
import { StudentFilterInput } from './dto/student-filter.input';
import { UpdateStudentInput } from './dto/update-student.input';
import { UploadStudentDocumentInput } from './dto/upload-student-document.input';
import { StudentConnection, StudentModel } from './models/student.model';
import { StudentDocumentModel } from './models/student-document.model';
import { StudentStatisticsModel } from './models/student-statistics.model';
import { StudentService } from './student.service';
import { StudentQueryService } from './student-query.service';

@UseGuards(GqlAuthGuard, InstituteScopeGuard, AbilityGuard)
@Resolver(() => StudentModel)
export class StudentResolver {
  constructor(
    private readonly studentService: StudentService,
    private readonly queries: StudentQueryService,
  ) {}

  @Query(() => StudentConnection, { description: 'List students with filters and pagination' })
  @CheckAbility({ action: 'read', subject: 'Student' })
  async listStudents(
    @CurrentReadAccess() access: InstituteReadAccess,
    @Args('filter', { nullable: true }) filter?: StudentFilterInput,
  ): Promise<InstanceType<typeof StudentConnection>> {
    return this.queries.list(filter ?? {}, access);
  }

  @Query(() => StudentModel, { description: 'Get a student by ID' })
  @CheckAbility({ action: 'read', subject: 'Student' })
  async getStudent(
    @Args('id', { type: () => ID }) id: string,
    @CurrentReadAccess() access: InstituteReadAccess,
  ): Promise<StudentModel> {
    return this.queries.findById(id, access);
  }

  @Query(() => StudentStatisticsModel, { description: 'Aggregate student statistics' })
  @CheckAbility({ action: 'read', subject: 'Student' })
  async studentStatistics(
    @CurrentReadAccess() access: InstituteReadAccess,
  ): Promise<StudentStatisticsModel> {
    return this.queries.statistics(access);
  }

  @Query(() => [StudentDocumentModel], {
    description: 'List uploaded documents for a single student (Documents tab on detail page).',
  })
  @CheckAbility({ action: 'read', subject: 'Student' })
  async listStudentDocuments(
    @Args('studentProfileId', { type: () => ID }) studentProfileId: string,
    @CurrentReadAccess() access: InstituteReadAccess,
  ): Promise<StudentDocumentModel[]> {
    return this.queries.listDocumentsForStudent(studentProfileId, access);
  }

  @Query(() => [DeletedPersonModel], {
    description: 'Soft-deleted students of this institute, most recently deleted first.',
  })
  @CheckAbility({ action: 'restore', subject: 'Student' })
  async listDeletedStudents(): Promise<DeletedPersonModel[]> {
    return this.studentService.listDeleted();
  }

  @Mutation(() => Boolean, {
    description:
      'Restore a soft-deleted student. Fails with ADMISSION_NUMBER_TAKEN when the admission number has been reissued.',
  })
  @CheckAbility({ action: 'restore', subject: 'Student' })
  async restoreStudent(@Args('id', { type: () => ID }) id: string): Promise<boolean> {
    return this.studentService.restore(id);
  }

  @Mutation(() => StudentModel, { description: 'Create a new student with admission' })
  @CheckAbility({ action: 'create', subject: 'Student' })
  async createStudent(@Args('input') input: CreateStudentInput): Promise<StudentModel> {
    return this.studentService.create(input);
  }

  @Mutation(() => StudentModel, { description: 'Update student profile (optimistic concurrency)' })
  @CheckAbility({ action: 'update', subject: 'Student' })
  async updateStudent(
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: UpdateStudentInput,
  ): Promise<StudentModel> {
    return this.studentService.update(id, input);
  }

  @Mutation(() => StudentModel, {
    description:
      'Explicit academic status transition (named domain mutation). Validates against the status state machine and emits STUDENT.statusChanged.',
  })
  @CheckAbility({ action: 'update', subject: 'Student' })
  async transitionStudentStatus(
    @Args('id', { type: () => ID }) id: string,
    @Args('newStatus', { type: () => AcademicStatus }) newStatus: AcademicStatus,
    @Args('reason', { nullable: true }) reason?: string,
  ): Promise<StudentModel> {
    return this.studentService.transitionStatus(id, newStatus, reason);
  }

  @Mutation(() => StudentDocumentModel, {
    description:
      'Saves a document for a student from files uploaded beforehand with `requestFileUpload`.',
  })
  @CheckAbility({ action: 'update', subject: 'Student' })
  async uploadStudentDocument(
    @Args('input') input: UploadStudentDocumentInput,
  ): Promise<StudentDocumentModel> {
    return this.studentService.uploadDocument(input);
  }

  @Mutation(() => Boolean, { description: 'Soft delete a student profile' })
  @CheckAbility({ action: 'delete', subject: 'Student' })
  async deleteStudent(@Args('id', { type: () => ID }) id: string): Promise<boolean> {
    return this.studentService.delete(id);
  }

  @Subscription(() => StudentModel, {
    filter: async function (
      this: StudentResolver,
      payload: { studentUpdated: { id: string; tenantId: string } },
      variables: { studentId: string },
      context: AbilityRequestContext,
    ) {
      return (
        context.req.user.scope === 'institute' &&
        payload.studentUpdated.tenantId === context.req.user.tenantId &&
        payload.studentUpdated.id === variables.studentId &&
        this.queries.filterEvent(payload.studentUpdated.id, context)
      );
    },
  })
  @CheckAbility({ action: 'read', subject: 'Student' })
  studentUpdated(@Args('studentId', { type: () => ID }) _studentId: string) {
    return pubSub.asyncIterableIterator('STUDENT.updated');
  }

  @Subscription(() => StudentModel, {
    name: 'studentsInTenantUpdated',
    resolve: (payload: { studentUpdated: StudentModel }) => payload.studentUpdated,
    filter: async function (
      this: StudentResolver,
      payload: { studentUpdated: { id: string; tenantId: string } },
      _variables: Record<string, never>,
      context: AbilityRequestContext,
    ) {
      return (
        context.req.user.scope === 'institute' &&
        payload.studentUpdated.tenantId === context.req.user.tenantId &&
        this.queries.filterEvent(payload.studentUpdated.id, context)
      );
    },
  })
  @CheckAbility({ action: 'read', subject: 'Student' })
  studentsInTenantUpdated() {
    return pubSub.asyncIterableIterator('STUDENT.updated');
  }
}
