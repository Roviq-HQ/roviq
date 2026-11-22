import type { FileStatus } from '../enums/file';
import { defineStateMachine } from '../state-machine';

export const FILE_STATE_MACHINE = defineStateMachine<FileStatus>('File', {
  PENDING: ['READY', 'REJECTED', 'QUARANTINED'],
  READY: ['DELETED'],
  REJECTED: [],
  QUARANTINED: [],
  DELETED: [],
});
