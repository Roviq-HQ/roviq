import { Field, Int, ObjectType } from '@nestjs/graphql';
import { NotificationChannel } from '@roviq/common-types';
import { DateTimeScalar } from '@roviq/nestjs-graphql';
import '../../../../common/notification-channel.enum';

@ObjectType('NotificationChannelHealth', {
  description: 'Delivery attempts on one channel over the last 24 hours, from the delivery rows',
})
export class NotificationChannelHealthModel {
  @Field(() => NotificationChannel)
  channel!: NotificationChannel;

  @Field(() => Int, {
    description: 'Messages the provider accepted, the delivery canary included',
  })
  sent24h!: number;

  @Field(() => Int, {
    description: 'Sends that failed, and messages the provider later reported undelivered',
  })
  failed24h!: number;
}

@ObjectType('NotificationCanaryStatus', {
  description: "The delivery canary's last success on one channel",
})
export class NotificationCanaryStatusModel {
  @Field(() => NotificationChannel)
  channel!: NotificationChannel;

  @Field(() => DateTimeScalar, {
    nullable: true,
    description: 'When the provider last accepted a canary on this channel; null when never',
  })
  lastSuccessAt!: Date | null;
}

@ObjectType('NotificationHealth', {
  description: 'Platform admin: whether notifications are being delivered (ROV-329)',
})
export class NotificationHealthModel {
  @Field(() => [NotificationChannelHealthModel], {
    description: 'Always all four channels, in NotificationChannel order',
  })
  channels!: NotificationChannelHealthModel[];

  @Field(() => [NotificationCanaryStatusModel], {
    description: 'Always all four channels; read from the delivery rows',
  })
  canary!: NotificationCanaryStatusModel[];

  @Field(() => DateTimeScalar)
  checkedAt!: Date;
}
