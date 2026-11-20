/** Codes `applyLeave` answers with that have their own `leave.errors.apply.*` message. */
const APPLY_ERROR_CODES = ['FORBIDDEN', 'LEAVE_DOCUMENT_REQUIRED', 'INVALID_DATE_RANGE'] as const;
export type ApplyLeaveErrorKey = (typeof APPLY_ERROR_CODES)[number];

/** Codes the approve / reject / cancel mutations answer with, keyed under `leave.errors.action.*`. */
const ACTION_ERROR_CODES = [
  'FORBIDDEN',
  'LEAVE_NOT_FOUND',
  'INVALID_STATE_TRANSITION',
  'LEAVE_NOT_EDITABLE',
] as const;
export type LeaveActionErrorKey = (typeof ACTION_ERROR_CODES)[number] | 'GENERIC';

/** Null when the code is not a leave rule, e.g. a file-upload code. */
export function applyLeaveErrorKey(code: string | null): ApplyLeaveErrorKey | null {
  return APPLY_ERROR_CODES.find((key) => key === code) ?? null;
}

export function leaveActionErrorKey(code: string | null): LeaveActionErrorKey {
  return ACTION_ERROR_CODES.find((key) => key === code) ?? 'GENERIC';
}
