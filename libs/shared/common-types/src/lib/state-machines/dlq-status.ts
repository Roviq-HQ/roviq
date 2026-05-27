import { defineStateMachine } from '../state-machine';

export type DlqStatus = 'pending' | 'replayed' | 'discarded';

export const DLQ_STATE_MACHINE = defineStateMachine<DlqStatus>('DlqMessage', {
  pending: ['replayed', 'discarded'],
  replayed: ['replayed', 'discarded'],
  discarded: [],
});
