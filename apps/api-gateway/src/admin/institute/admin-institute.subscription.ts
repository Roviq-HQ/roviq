/**
 * Platform-scope GraphQL subscriptions for institute events.
 *
 * No filter — platform admins see ALL institute events across
 * the entire platform.
 */
import { Resolver, Subscription } from '@nestjs/graphql';
import { PlatformScope } from '@roviq/auth-backend';
import GraphQLJSON from 'graphql-type-json';
import { pubSub } from '../../common/pubsub';

@PlatformScope()
@Resolver()
export class AdminInstituteSubscriptionResolver {
  /** An institute has requested approval */
  @Subscription(() => GraphQLJSON)
  adminInstituteApprovalRequested() {
    return pubSub.asyncIterableIterator('INSTITUTE.approval_requested');
  }

  /** A new institute was created anywhere on the platform */
  @Subscription(() => GraphQLJSON)
  adminInstituteCreated() {
    return pubSub.asyncIterableIterator('INSTITUTE.created');
  }
}
