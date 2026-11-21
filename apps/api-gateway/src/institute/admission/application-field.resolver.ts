import { Parent, ResolveField, Resolver } from '@nestjs/graphql';
import { assertTenantContext, CurrentUser } from '@roviq/auth-backend';
import type { AuthUser } from '@roviq/common-types';
import type { I18nContent } from '@roviq/database';
import { I18nTextScalar } from '@roviq/nestjs-graphql';
import { ApplicationModel } from './models/application.model';
import { StandardNameLoaders } from './standard-name.loaders';

// Field-only: the parent was already read through ApplicationResolver's guards.
@Resolver(() => ApplicationModel)
export class ApplicationFieldResolver {
  constructor(private readonly standards: StandardNameLoaders) {}

  @ResolveField(() => I18nTextScalar, {
    nullable: true,
    description: 'Name (i18n) of the standard applied for',
  })
  standardName(
    @Parent() application: ApplicationModel,
    @CurrentUser() user: AuthUser,
  ): Promise<I18nContent | null> {
    assertTenantContext(user);
    return this.standards.byId(user).load(application.standardId);
  }
}
