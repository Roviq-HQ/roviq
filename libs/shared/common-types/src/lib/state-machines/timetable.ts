import type { TimetableStatus } from '../enums/timetable';
import { defineStateMachine } from '../state-machine';

/**
 * DRAFT → ACTIVE (publish) / ARCHIVED (discard).
 * ACTIVE → INACTIVE (retire) / ARCHIVED.
 * INACTIVE → ACTIVE (re-activate) / ARCHIVED.
 * ARCHIVED is terminal.
 *
 * Activating is additionally guarded at the service layer (single ACTIVE per
 * institute + academic year) and by a partial-unique index in the DB.
 */
export const TIMETABLE_STATE_MACHINE = defineStateMachine<TimetableStatus>('Timetable', {
  DRAFT: ['ACTIVE', 'ARCHIVED'],
  ACTIVE: ['INACTIVE', 'ARCHIVED'],
  INACTIVE: ['ACTIVE', 'ARCHIVED'],
  ARCHIVED: [],
});
