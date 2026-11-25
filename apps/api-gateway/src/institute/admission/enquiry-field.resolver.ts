import { Parent, ResolveField, Resolver } from '@nestjs/graphql';
import { assertTenantContext, CurrentUser } from '@roviq/auth-backend';
import type { AuthUser } from '@roviq/common-types';
import { AssigneeLoaders } from './assignee.loaders';
import { EnquiryModel } from './models/enquiry.model';
import { EnquiryAssigneeModel } from './models/enquiry-assignee.model';

// Field-only: the parent was already read through EnquiryResolver's guards.
@Resolver(() => EnquiryModel)
export class EnquiryFieldResolver {
  constructor(private readonly assignees: AssigneeLoaders) {}

  @ResolveField(() => EnquiryAssigneeModel, {
    nullable: true,
    description:
      'Staff member named by `assignedTo`; null when unassigned or when this institute has no profile for that user',
  })
  async assignee(
    @Parent() enquiry: EnquiryModel,
    @CurrentUser() user: AuthUser,
  ): Promise<EnquiryAssigneeModel | null> {
    if (!enquiry.assignedTo) return null;
    assertTenantContext(user);
    return this.assignees.byUserId(user).load(enquiry.assignedTo);
  }
}
