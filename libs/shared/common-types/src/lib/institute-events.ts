/**
 * Typed event interfaces for all institute lifecycle NATS events (ROV-117).
 * Each event carries a scope field for audit trail and subscription filtering.
 */

/** Base fields present on every institute event */
interface InstituteEventBase {
  instituteId: string;
  /** Scope determines which subscription receives this event */
  scope: 'platform' | 'reseller' | 'institute';
  /** Reseller that owns this institute (for reseller-scope filtering) */
  resellerId?: string;
  /** Tenant ID (same as instituteId for institute-scope filtering) */
  tenantId?: string;
}

/** Reseller staff requested platform admin approval for new institute */
export interface InstituteApprovalRequestedEvent extends InstituteEventBase {
  requestedBy: string;
}

/** Platform admin approved a pending institute */
export interface InstituteApprovedEvent extends InstituteEventBase {
  approvedBy: string;
}

/** Institute was created (by platform admin or reseller after approval) */
export interface InstituteCreatedEvent extends InstituteEventBase {
  name: Record<string, string>;
  type: string;
  slug: string;
}

/** Institute status changed to active */
export interface InstituteActivatedEvent extends InstituteEventBase {
  previousStatus: string;
}

/** Institute was suspended by platform admin or reseller */
export interface InstituteSuspendedEvent extends InstituteEventBase {
  suspendedBy: string;
  reason?: string;
}

/** Institute reassigned from one reseller to another */
export interface InstituteResellerChangedEvent extends InstituteEventBase {
  oldResellerId: string;
  newResellerId: string;
}

/** Institute was soft-deleted */
export interface InstituteDeletedEvent extends InstituteEventBase {
  deletedBy: string;
}

/** Institute was restored from trash */
export interface InstituteRestoredEvent extends InstituteEventBase {
  restoredBy: string;
}

/** Institute config was updated (attendance, shifts, grading, etc.) */
export interface InstituteConfigUpdatedEvent extends InstituteEventBase {
  changedFields: string[];
}

/** Institute branding was updated (logo, colors, theme) */
export interface InstituteBrandingUpdatedEvent extends InstituteEventBase {
  branding: Record<string, unknown>;
}

/** Union type for all institute events */
export type InstituteEvent =
  | InstituteApprovalRequestedEvent
  | InstituteApprovedEvent
  | InstituteCreatedEvent
  | InstituteActivatedEvent
  | InstituteSuspendedEvent
  | InstituteResellerChangedEvent
  | InstituteDeletedEvent
  | InstituteRestoredEvent
  | InstituteConfigUpdatedEvent
  | InstituteBrandingUpdatedEvent;

/** NATS subject patterns for institute events */
export const INSTITUTE_EVENTS = {
  APPROVAL_REQUESTED: 'INSTITUTE.approval_requested',
  APPROVED: 'INSTITUTE.approved',
  CREATED: 'INSTITUTE.created',
  ACTIVATED: 'INSTITUTE.activated',
  SUSPENDED: 'INSTITUTE.suspended',
  RESELLER_CHANGED: 'INSTITUTE.reseller_changed',
  DELETED: 'INSTITUTE.deleted',
  RESTORED: 'INSTITUTE.restored',
  CONFIG_UPDATED: 'INSTITUTE.config_updated',
  BRANDING_UPDATED: 'INSTITUTE.branding_updated',
} as const;
