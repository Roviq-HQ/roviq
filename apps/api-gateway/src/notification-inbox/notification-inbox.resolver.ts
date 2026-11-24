import { UseGuards } from '@nestjs/common';
import { Args, ID, Int, Mutation, Query, Resolver, Subscription } from '@nestjs/graphql';
import { CurrentUser, GqlAuthGuard } from '@roviq/auth-backend';
import { type AuthUser, DevicePlatform } from '@roviq/common-types';
import { pubSub } from '@roviq/pubsub';
import { NotificationConnection, NotificationModel } from './models/notification.model';
import { type NotificationFeedEvent, notificationFeedTopic } from './notification-feed';
import {
  type NotificationConnectionResult,
  NotificationInboxService,
} from './notification-inbox.service';
import { ownFeedIterator } from './own-feed-iterator';
import type { NotificationRecord } from './repositories/notification-inbox.repository';

/** Every scope's own inbox: no scope guard, the token alone decides whose rows these are. */
@UseGuards(GqlAuthGuard)
@Resolver(() => NotificationModel)
export class NotificationInboxResolver {
  constructor(private readonly service: NotificationInboxService) {}

  @Query(() => NotificationConnection, {
    description:
      "The signed-in user's notifications in this scope, newest first, archived ones left out.",
  })
  myNotifications(
    @CurrentUser() user: AuthUser,
    @Args('first', { type: () => Int, nullable: true, defaultValue: 20 }) first: number,
    @Args('after', { type: () => String, nullable: true }) after: string | null,
    @Args('unreadOnly', { type: () => Boolean, nullable: true, defaultValue: false })
    unreadOnly: boolean,
  ): Promise<NotificationConnectionResult> {
    return this.service.list(user, { first, after, unreadOnly });
  }

  @Query(() => Int, { description: 'Unread, unarchived notifications of the signed-in user.' })
  myUnreadNotificationCount(@CurrentUser() user: AuthUser): Promise<number> {
    return this.service.countUnread(user);
  }

  @Mutation(() => NotificationModel, {
    description: 'Marks one of your notifications read. Already read is not an error.',
  })
  markNotificationRead(
    @CurrentUser() user: AuthUser,
    @Args('id', { type: () => ID }) id: string,
  ): Promise<NotificationRecord> {
    return this.service.markRead(user, id);
  }

  @Mutation(() => Int, { description: 'Marks every unread notification read; returns how many.' })
  markAllNotificationsRead(@CurrentUser() user: AuthUser): Promise<number> {
    return this.service.markAllRead(user);
  }

  @Mutation(() => NotificationModel, {
    description: 'Hides one of your notifications from the inbox.',
  })
  archiveNotification(
    @CurrentUser() user: AuthUser,
    @Args('id', { type: () => ID }) id: string,
  ): Promise<NotificationRecord> {
    return this.service.archive(user, id);
  }

  @Mutation(() => Boolean, {
    description:
      "Called by the device when it shows the push of one of your notifications, so no WhatsApp or SMS follows. Someone else's id answers NOTIFICATION_NOT_FOUND.",
  })
  acknowledgeNotificationDelivery(
    @CurrentUser() user: AuthUser,
    @Args('notificationId', { type: () => ID }) notificationId: string,
  ): Promise<boolean> {
    return this.service.acknowledgeDelivery(user, notificationId);
  }

  @Subscription(() => NotificationModel, {
    description: 'A new notification for the signed-in user in this scope.',
    resolve: (record: NotificationRecord) => record,
  })
  notificationReceived(@CurrentUser() user: AuthUser): AsyncIterableIterator<NotificationRecord> {
    return ownFeedIterator(
      pubSub.asyncIterableIterator<NotificationFeedEvent>(notificationFeedTopic(user.userId)),
      (event) => this.service.findOwn(user, event.notificationId),
    );
  }

  @Mutation(() => Boolean, {
    description: "Registers this device for the signed-in user's push messages.",
  })
  registerDeviceToken(
    @CurrentUser() user: AuthUser,
    @Args('token', { description: 'FCM or APNs token as the device reported it.' }) token: string,
    @Args('platform', { type: () => DevicePlatform }) platform: DevicePlatform,
  ): Promise<boolean> {
    return this.service.registerDeviceToken(user, token, platform);
  }

  @Mutation(() => Boolean, {
    description: 'Stops push messages to this device. Succeeds whether or not it was registered.',
  })
  unregisterDeviceToken(
    @CurrentUser() user: AuthUser,
    @Args('token') token: string,
  ): Promise<boolean> {
    return this.service.unregisterDeviceToken(user, token);
  }
}
