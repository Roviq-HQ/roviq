import type { ApolloServerPlugin, BaseContext, GraphQLRequestListener } from '@apollo/server';
import { Plugin } from '@nestjs/apollo';
import { metrics } from '@opentelemetry/api';
import type { AuthUser } from '@roviq/common-types';

export const TENANT_API_REQUESTS_METRIC = 'roviq.api.requests';

export interface GqlContext extends BaseContext {
  req?: { user?: AuthUser };
}

/**
 * Counts one per GraphQL operation sent over HTTP by an institute-scope caller. An Apollo
 * plugin (not a Nest interceptor) so a multi-root-field operation counts once, and graphql-ws
 * subscriptions bypass Apollo's request pipeline so long-lived pushes are not counted.
 */
@Plugin()
export class TenantApiRequestsPlugin implements ApolloServerPlugin<GqlContext> {
  private readonly counter = metrics
    .getMeter('api-gateway')
    .createCounter(TENANT_API_REQUESTS_METRIC, {
      description: 'GraphQL operations made by institute-scope callers, by tenant',
    });

  async requestDidStart(): Promise<GraphQLRequestListener<GqlContext>> {
    const counter = this.counter;
    return {
      // req.user is only set once GqlAuthGuard ran inside a resolver, so read it at the end.
      async willSendResponse({ contextValue }) {
        const user = contextValue.req?.user;
        if (user?.scope === 'institute') counter.add(1, { tenant_id: user.tenantId });
      },
    };
  }
}
