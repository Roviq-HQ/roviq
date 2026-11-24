import { registerEnumType } from '@nestjs/graphql';
import { NotificationChannel } from '@roviq/common-types';

// Shared by the platform and institute delivery logs; registered once.
registerEnumType(NotificationChannel, {
  name: 'NotificationChannel',
  description: 'Channel outside the app a notification was sent on.',
});
