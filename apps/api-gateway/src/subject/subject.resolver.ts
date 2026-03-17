import { UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { GqlAuthGuard } from '../auth/guards/gql-auth.guard';
import { CreateSubjectInput } from './dto/create-subject.input';
import { UpdateSubjectInput } from './dto/update-subject.input';
import { SubjectModel } from './models/subject.model';
import { SubjectService } from './subject.service';

@Resolver(() => SubjectModel)
export class SubjectResolver {
  constructor(private readonly subjectService: SubjectService) {}

  @Query(() => [SubjectModel])
  @UseGuards(GqlAuthGuard)
  async subjects(): Promise<SubjectModel[]> {
    return this.subjectService.findAll();
  }

  @Query(() => SubjectModel)
  @UseGuards(GqlAuthGuard)
  async subject(@Args('id', { type: () => ID }) id: string): Promise<SubjectModel> {
    return this.subjectService.findById(id);
  }

  @Query(() => [SubjectModel])
  @UseGuards(GqlAuthGuard)
  async subjectsByStandard(
    @Args('standardId', { type: () => ID }) standardId: string,
  ): Promise<SubjectModel[]> {
    return this.subjectService.findByStandard(standardId);
  }

  @Mutation(() => SubjectModel)
  @UseGuards(GqlAuthGuard)
  async createSubject(@Args('input') input: CreateSubjectInput): Promise<SubjectModel> {
    return this.subjectService.create(input);
  }

  @Mutation(() => SubjectModel)
  @UseGuards(GqlAuthGuard)
  async updateSubject(
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: UpdateSubjectInput,
  ): Promise<SubjectModel> {
    return this.subjectService.update(id, input);
  }

  @Mutation(() => Boolean)
  @UseGuards(GqlAuthGuard)
  async deleteSubject(@Args('id', { type: () => ID }) id: string): Promise<boolean> {
    return this.subjectService.delete(id);
  }

  @Mutation(() => Boolean)
  @UseGuards(GqlAuthGuard)
  async assignSubjectToStandard(
    @Args('subjectId', { type: () => ID }) subjectId: string,
    @Args('standardId', { type: () => ID }) standardId: string,
  ): Promise<boolean> {
    return this.subjectService.assignToStandard(subjectId, standardId);
  }

  @Mutation(() => Boolean)
  @UseGuards(GqlAuthGuard)
  async removeSubjectFromStandard(
    @Args('subjectId', { type: () => ID }) subjectId: string,
    @Args('standardId', { type: () => ID }) standardId: string,
  ): Promise<boolean> {
    return this.subjectService.removeFromStandard(subjectId, standardId);
  }

  @Mutation(() => Boolean)
  @UseGuards(GqlAuthGuard)
  async assignSubjectToSection(
    @Args('subjectId', { type: () => ID }) subjectId: string,
    @Args('sectionId', { type: () => ID }) sectionId: string,
  ): Promise<boolean> {
    return this.subjectService.assignToSection(subjectId, sectionId);
  }

  @Mutation(() => Boolean)
  @UseGuards(GqlAuthGuard)
  async removeSubjectFromSection(
    @Args('subjectId', { type: () => ID }) subjectId: string,
    @Args('sectionId', { type: () => ID }) sectionId: string,
  ): Promise<boolean> {
    return this.subjectService.removeFromSection(subjectId, sectionId);
  }
}
