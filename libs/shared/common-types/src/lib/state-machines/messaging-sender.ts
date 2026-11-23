import type { MessagingSenderStatus } from '../enums/notification';
import { defineStateMachine } from '../state-machine';

export const MESSAGING_SENDER_STATE_MACHINE = defineStateMachine<MessagingSenderStatus>(
  'MessagingSender',
  {
    ACTIVE: ['PAUSED', 'BLOCKED'],
    PAUSED: ['ACTIVE', 'BLOCKED'],
    BLOCKED: ['ACTIVE'],
  },
);
