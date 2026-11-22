import { Field, ID, ObjectType, registerEnumType } from '@nestjs/graphql';
import { DevicePlatform } from '@roviq/common-types';
import type { I18nContent } from '@roviq/database';
import { DateTimeScalar, I18nTextScalar } from '@roviq/nestjs-graphql';
import GraphQLJSON from 'graphql-type-json';
import { createConnectionType } from '../../common/pagination/relay-pagination.model';

registerEnumType(DevicePlatform, {
  name: 'DevicePlatform',
  description: 'Operating system family of a device that receives push messages.',
});

@ObjectType({ description: 'One in-app notification addressed to the signed-in user.' })
export class NotificationModel {
  @Field(() => ID)
  id!: string;

  @Field({ description: 'Notification kind, e.g. ATTENDANCE_ABSENT or LEAVE_DECIDED.' })
  type!: string;

  @Field(() => I18nTextScalar, { description: 'All locales; the client picks one.' })
  title!: I18nContent;

  @Field(() => I18nTextScalar, { description: 'All locales; the client picks one.' })
  body!: I18nContent;

  @Field(() => GraphQLJSON, {
    nullable: true,
    description: 'Deep-link target and entity ids for the client to open.',
  })
  data!: Record<string, unknown> | null;

  @Field(() => DateTimeScalar, { nullable: true })
  readAt!: Date | null;

  @Field(() => DateTimeScalar, { nullable: true })
  archivedAt!: Date | null;

  @Field(() => DateTimeScalar)
  createdAt!: Date;
}

export const { ConnectionType: NotificationConnection } = createConnectionType(
  NotificationModel,
  'Notification',
);
