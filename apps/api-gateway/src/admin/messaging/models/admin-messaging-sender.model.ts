import { Field, ID, Int, ObjectType, registerEnumType } from '@nestjs/graphql';
import { MessageTemplateCategory, MessagingSenderStatus } from '@roviq/common-types';
import { DateTimeScalar } from '@roviq/nestjs-graphql';

registerEnumType(MessagingSenderStatus, {
  name: 'MessagingSenderStatus',
  description: 'State of a WhatsApp sender. Only an ACTIVE sender sends.',
});
registerEnumType(MessageTemplateCategory, {
  name: 'MessageTemplateCategory',
  description: "The provider's price class of a message template.",
});

@ObjectType({
  description:
    "A WhatsApp number messages are sent from: the platform's, or one institute's own. Its access token is never returned.",
})
export class AdminMessagingSender {
  @Field(() => ID)
  id!: string;

  @Field({ description: "'platform' or 'institute'." })
  scope!: string;

  @Field(() => ID, {
    nullable: true,
    description: "The institute; null for the platform's sender.",
  })
  tenantId!: string | null;

  @Field({ description: "The provider's id of the number; inbound webhooks are matched by it." })
  providerNumberId!: string;

  @Field({ description: 'The number as people see it, E.164 with a leading +.' })
  displayNumber!: string;

  @Field(() => MessagingSenderStatus)
  status!: MessagingSenderStatus;

  @Field(() => Int, { description: 'Messages the sender may send in any 24 hours.' })
  dailyCap!: number;

  @Field(() => Int, {
    nullable: true,
    description:
      "On the platform's sender: what one institute may use of dailyCap. Null means no share limit; always null on an institute's sender.",
  })
  instituteDailyCap!: number | null;

  @Field(() => Int, {
    description:
      'Messages the sender hands the provider per second, over every notification service instance (1 to 1000).',
  })
  messagesPerSecond!: number;

  @Field(() => DateTimeScalar)
  createdAt!: Date;

  @Field(() => DateTimeScalar)
  updatedAt!: Date;
}

@ObjectType({
  description:
    'WhatsApp messages the provider accepted (status SENT) in one month, per institute and template category.',
})
export class AdminWhatsAppUsageRow {
  @Field(() => ID, {
    nullable: true,
    description: 'The institute; null for platform-scope messages.',
  })
  tenantId!: string | null;

  @Field(() => MessageTemplateCategory, {
    nullable: true,
    description: 'Null for messages sent without a recorded category.',
  })
  templateCategory!: MessageTemplateCategory | null;

  @Field(() => Int)
  sentCount!: number;
}

@ObjectType({
  description:
    'SMS messages the provider accepted (status SENT) in one month, per institute and notification type.',
})
export class AdminSmsUsageRow {
  @Field(() => ID, {
    nullable: true,
    description: 'The institute; null for platform-scope messages.',
  })
  tenantId!: string | null;

  @Field({ description: 'The notification type key, such as FEE_REMINDER.' })
  type!: string;

  @Field(() => Int)
  sentCount!: number;
}
