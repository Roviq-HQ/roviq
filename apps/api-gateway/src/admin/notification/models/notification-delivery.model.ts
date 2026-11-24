import { Field, ID, InputType, Int, ObjectType, registerEnumType } from '@nestjs/graphql';
import {
  NOTIFICATION_CHANNEL_VALUES,
  NOTIFICATION_DELIVERY_STATUS_VALUES,
  NotificationChannel,
  NotificationDeliveryStatus,
} from '@roviq/common-types';
import { DateTimeScalar } from '@roviq/nestjs-graphql';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import '../../../common/notification-channel.enum';
import { createConnectionType } from '../../../common/pagination/relay-pagination.model';

registerEnumType(NotificationDeliveryStatus, {
  name: 'NotificationDeliveryStatus',
  description: 'Outcome of one delivery attempt.',
});

@ObjectType({
  description: 'One attempt to send a notification outside the app (append-only log).',
})
export class NotificationDeliveryModel {
  @Field(() => ID)
  id!: string;

  @Field({ description: "'institute', 'reseller' or 'platform'." })
  scope!: string;

  @Field(() => ID, { nullable: true })
  tenantId!: string | null;

  @Field(() => ID, { nullable: true })
  resellerId!: string | null;

  @Field(() => ID, {
    nullable: true,
    description: 'The in-app copy, if any; null for codes and welcome messages.',
  })
  notificationId!: string | null;

  @Field(() => ID)
  recipientUserId!: string;

  @Field()
  type!: string;

  @Field(() => NotificationChannel)
  channel!: NotificationChannel;

  @Field(() => String, { nullable: true, description: 'Adapter that handled the attempt.' })
  provider!: string | null;

  @Field(() => NotificationDeliveryStatus)
  status!: NotificationDeliveryStatus;

  @Field(() => String, { nullable: true, description: 'Why a SKIPPED attempt was not made.' })
  skipReason!: string | null;

  @Field(() => String, { nullable: true })
  providerMessageId!: string | null;

  @Field(() => String, { nullable: true, description: 'Why a FAILED attempt failed.' })
  errorCode!: string | null;

  @Field(() => Int)
  attempt!: number;

  @Field(() => DateTimeScalar)
  createdAt!: Date;
}

@InputType({ description: 'Filters for the notification delivery log; all optional.' })
export class NotificationDeliveryFilterInput {
  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsUUID()
  tenantId?: string;

  @Field(() => NotificationChannel, { nullable: true })
  @IsOptional()
  @IsIn(NOTIFICATION_CHANNEL_VALUES)
  channel?: NotificationChannel;

  @Field(() => NotificationDeliveryStatus, { nullable: true })
  @IsOptional()
  @IsIn(NOTIFICATION_DELIVERY_STATUS_VALUES)
  status?: NotificationDeliveryStatus;

  @Field({ nullable: true, description: 'Notification kind, e.g. ATTENDANCE_ABSENT.' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  type?: string;

  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsUUID()
  recipientUserId?: string;
}

export const { ConnectionType: NotificationDeliveryConnection } = createConnectionType(
  NotificationDeliveryModel,
  'NotificationDelivery',
);
