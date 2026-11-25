import { Field, ID, Int, ObjectType, registerEnumType } from '@nestjs/graphql';
import {
  MessageTemplateCategory,
  MessageTemplateStatus,
  MessagingSenderStatus,
} from '@roviq/common-types';
import { DateTimeScalar } from '@roviq/nestjs-graphql';

registerEnumType(MessagingSenderStatus, {
  name: 'MessagingSenderStatus',
  description: 'State of a WhatsApp sender. Only an ACTIVE sender sends.',
});
registerEnumType(MessageTemplateStatus, {
  name: 'MessageTemplateStatus',
  description: 'Where a WhatsApp template stands at the provider. Only APPROVED is sent.',
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

  @Field(() => String, {
    nullable: true,
    description:
      'The provider account the number belongs to; its WhatsApp templates are registered there. Null for a sender registered before accounts were recorded.',
  })
  providerAccountId!: string | null;

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

@ObjectType({
  description:
    "One code-defined WhatsApp template in one language at a sender's provider account (ROV-333).",
})
export class AdminMessagingTemplate {
  @Field({ description: 'The template name, version included (attendance_absent_v1).' })
  name!: string;

  @Field({ description: "'en' or 'hi'." })
  language!: string;

  @Field(() => MessageTemplateStatus)
  status!: MessageTemplateStatus;

  @Field({ description: 'The category the code declares.' })
  declaredCategory!: string;

  @Field(() => String, {
    nullable: true,
    description:
      'The category the provider approved it under; null until reviewed. When it differs from declaredCategory the template is not sent.',
  })
  approvedCategory!: string | null;

  @Field(() => String, { nullable: true, description: "The provider's reason for a rejection." })
  rejectedReason!: string | null;

  @Field(() => String, { nullable: true, description: "The provider's quality score." })
  quality!: string | null;

  @Field(() => String, {
    nullable: true,
    description: 'A category the provider suggests on its own review; shown, never applied.',
  })
  suggestedCategory!: string | null;

  @Field({
    description:
      "True when the provider's text no longer matches the code's definition (edited at the provider).",
  })
  outOfStep!: boolean;

  @Field({ description: 'APPROVED under the declared category: messages using it are sent.' })
  sendable!: boolean;

  @Field(() => DateTimeScalar)
  updatedAt!: Date;
}
