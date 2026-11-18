import { Field, ID, ObjectType, Resolver, Subscription } from '@nestjs/graphql';
import { PlatformScope } from '@roviq/auth-backend';
import { EVENT_PATTERNS } from '@roviq/nats-jetstream';
import { pubSub } from '../../common/pubsub';

@ObjectType({
  description:
    'Signal that an impersonation session started or ended. Carries no session detail: clients re-read the list, which checks their ability.',
})
export class ImpersonationSessionEventModel {
  @Field(() => ID)
  id!: string;

  @Field({
    description: "Scope the impersonator acted from: 'platform', 'reseller' or 'institute'",
  })
  impersonatorScope!: string;
}

@PlatformScope()
@Resolver()
export class AdminImpersonationSubscriptionResolver {
  @Subscription(() => ImpersonationSessionEventModel, {
    description: 'A session was opened anywhere on the platform',
    resolve: (payload: { impersonationSessionStarted: ImpersonationSessionEventModel }) =>
      payload.impersonationSessionStarted,
  })
  adminImpersonationSessionCreated() {
    return pubSub.asyncIterableIterator(EVENT_PATTERNS.IMPERSONATION.session_started);
  }

  @Subscription(() => ImpersonationSessionEventModel, {
    description: 'A session was ended, revoked or expired by the sweeper',
    resolve: (payload: { impersonationSessionEnded: ImpersonationSessionEventModel }) =>
      payload.impersonationSessionEnded,
  })
  adminImpersonationSessionEnded() {
    return pubSub.asyncIterableIterator(EVENT_PATTERNS.IMPERSONATION.session_ended);
  }
}
