/**
 * Reseller-scope GraphQL subscriptions for institute events.
 *
 * Filtered by resellerId from JWT — reseller users only receive
 * events for institutes belonging to their reseller.
 */
import { Resolver, Subscription } from '@nestjs/graphql';
import { ResellerScope } from '@roviq/auth-backend';
import type { AuthUser } from '@roviq/common-types';
import GraphQLJSON from 'graphql-type-json';
import { pubSub } from '../../common/pubsub';

@ResellerScope()
@Resolver()
export class ResellerInstituteSubscriptionResolver {
  /** New institute created under this reseller */
  @Subscription(() => GraphQLJSON, {
    filter: (
      payload: { resellerInstituteCreated: { resellerId: string } },
      _args: unknown,
      context: { req: { user: AuthUser } },
    ) => payload.resellerInstituteCreated.resellerId === context.req.user.resellerId,
  })
  resellerInstituteCreated() {
    return pubSub.asyncIterableIterator('INSTITUTE.created');
  }

  /** Status change on an institute under this reseller */
  @Subscription(() => GraphQLJSON, {
    filter: (
      payload: { resellerInstituteStatusChanged: { resellerId: string } },
      _args: unknown,
      context: { req: { user: AuthUser } },
    ) => payload.resellerInstituteStatusChanged.resellerId === context.req.user.resellerId,
  })
  resellerInstituteStatusChanged() {
    return pubSub.asyncIterableIterator('INSTITUTE.status_changed');
  }
}
