import { Field, ID, InputType, ObjectType, registerEnumType } from '@nestjs/graphql';
import {
  NOTIFICATION_CHANNEL_VALUES,
  NOTIFICATION_DELIVERY_STATE_VALUES,
  NOTIFICATION_MODULE_VALUES,
  NOTIFICATION_TYPE_VALUES,
  NotificationChannel,
  NotificationDeliveryState,
  NotificationModule,
  type NotificationTypeKey,
} from '@roviq/common-types';
import type { I18nContent } from '@roviq/database';
import { DateTimeScalar, I18nTextScalar } from '@roviq/nestjs-graphql';
import { IsBoolean, IsDate, IsIn, IsOptional, IsUUID } from 'class-validator';
import '../../../common/notification-channel.enum';
import { createConnectionType } from '../../../common/pagination/relay-pagination.model';

registerEnumType(NotificationModule, {
  name: 'NotificationModule',
  description: 'The part of the product a notification type belongs to.',
});
registerEnumType(NotificationDeliveryState, {
  name: 'NotificationDeliveryState',
  description:
    'State of one message to one recipient on one channel: READ or DELIVERED when any report says so, else the latest attempt (SENT, FAILED, SKIPPED; a held message is WAITING).',
});

@ObjectType({ description: 'Where one message to one recipient stands on one channel.' })
export class NotificationDeliveryChannelState {
  @Field(() => NotificationChannel)
  channel!: NotificationChannel;

  @Field(() => NotificationDeliveryState)
  state!: NotificationDeliveryState;

  @Field(() => String, {
    nullable: true,
    description:
      'For FAILED, SKIPPED and WAITING: the skip reason (e.g. `no_consent`, `quiet_hours`) or error code (e.g. `WA_NOT_ON_WHATSAPP`) of the latest attempt; otherwise null.',
  })
  reason!: string | null;

  @Field(() => DateTimeScalar, { description: 'Time of the attempt or report that set the state.' })
  at!: Date;
}

@ObjectType({
  description: 'One message to one recipient, with its state on every channel it was tried on.',
})
export class NotificationDeliveryLogEntry {
  @Field(() => ID, { description: 'Opaque; stable for the same message and recipient.' })
  id!: string;

  @Field({ description: 'Notification kind, e.g. ATTENDANCE_ABSENT.' })
  type!: string;

  @Field(() => NotificationModule)
  module!: NotificationModule;

  @Field({ description: 'Sent whatever the institute settings say and outside quiet hours.' })
  critical!: boolean;

  @Field(() => DateTimeScalar, { description: 'Time of the first attempt of the message.' })
  at!: Date;

  @Field(() => ID, {
    nullable: true,
    description: 'Membership id of the student the message is about, when it is about one.',
  })
  studentMembershipId!: string | null;

  @Field(() => I18nTextScalar, { nullable: true })
  studentFirstName!: I18nContent | null;

  @Field(() => I18nTextScalar, { nullable: true })
  studentLastName!: I18nContent | null;

  @Field(() => ID)
  recipientUserId!: string;

  @Field(() => I18nTextScalar, {
    nullable: true,
    description: "From the institute's register; null when the institute holds no profile.",
  })
  recipientFirstName!: I18nContent | null;

  @Field(() => I18nTextScalar, { nullable: true })
  recipientLastName!: I18nContent | null;

  @Field(() => String, {
    nullable: true,
    description:
      "The recipient's relationship to the student (a GuardianRelationship), when known.",
  })
  relationship!: string | null;

  @Field(() => [NotificationDeliveryChannelState])
  channels!: NotificationDeliveryChannelState[];
}

@InputType({ description: 'Filters for the institute notification delivery log; all optional.' })
export class NotificationDeliveryLogFilterInput {
  @Field(() => NotificationModule, { nullable: true })
  @IsOptional()
  @IsIn(NOTIFICATION_MODULE_VALUES)
  module?: NotificationModule;

  @Field(() => String, { nullable: true, description: 'Notification kind, e.g. FEE_OVERDUE.' })
  @IsOptional()
  @IsIn(NOTIFICATION_TYPE_VALUES)
  type?: NotificationTypeKey;

  @Field(() => NotificationChannel, {
    nullable: true,
    description: 'Messages tried on this channel (with `state`: in that state on this channel).',
  })
  @IsOptional()
  @IsIn(NOTIFICATION_CHANNEL_VALUES)
  channel?: NotificationChannel;

  @Field(() => NotificationDeliveryState, {
    nullable: true,
    description: 'Messages with at least one channel in this state.',
  })
  @IsOptional()
  @IsIn(NOTIFICATION_DELIVERY_STATE_VALUES)
  state?: NotificationDeliveryState;

  @Field(() => ID, { nullable: true, description: 'Student membership id.' })
  @IsOptional()
  @IsUUID()
  studentId?: string;

  @Field(() => ID, { nullable: true, description: 'Attendance session id.' })
  @IsOptional()
  @IsUUID()
  sessionId?: string;

  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsUUID()
  recipientUserId?: string;

  @Field(() => DateTimeScalar, { nullable: true, description: 'First attempt at or after.' })
  @IsOptional()
  @IsDate()
  from?: Date;

  @Field(() => DateTimeScalar, { nullable: true, description: 'First attempt at or before.' })
  @IsOptional()
  @IsDate()
  to?: Date;

  @Field(() => Boolean, { nullable: true, description: 'Only critical types.' })
  @IsOptional()
  @IsBoolean()
  criticalOnly?: boolean;

  @Field(() => Boolean, {
    nullable: true,
    description: 'Only messages that no channel has DELIVERED or READ.',
  })
  @IsOptional()
  @IsBoolean()
  notDeliveredOnly?: boolean;
}

export const { ConnectionType: NotificationDeliveryLogConnection } = createConnectionType(
  NotificationDeliveryLogEntry,
  'NotificationDeliveryLog',
);
