import {
  AUTH_SCOPE_VALUES,
  AUTH_SECURITY_EVENT_TYPE_VALUES,
  COMPLIANCE_REPORT_TYPE_VALUES,
  FILE_PURPOSE_VALUES,
  NOTIFICATION_CHANNEL_VALUES,
} from '@roviq/common-types';
import { z } from 'zod';
import type { EventPattern } from './event-patterns';

// ── Reusable field building blocks ────────────────────────────────────────────

const uuid = z.string().uuid();
const str = z.string();
const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
// Permissive base: all tenant-scoped events carry at least tenantId.
const tenantBase = z.object({ tenantId: uuid });
// Institute-record events identify the institute by `id` (the InstituteRecord
// PK, which IS the tenantId from the consumer's perspective). Required
// `tenantId` mirrors `id` so consumer DLQs can route on tenantId uniformly,
// per the backend-service skill rule "always include tenantId in event
// payloads". Used by INSTITUTE.* events that spread the full institute
// record into the payload.
const instituteRecordBase = z.object({ id: uuid, tenantId: uuid });
// Institute-id-keyed base: lifecycle events that don't spread the record
// (status changes, branding/config updates, setup events). Same `tenantId`
// invariant as instituteRecordBase. The `instituteId` key is preserved
// because GraphQL subscriptions filter on it.
const instituteIdBase = z.object({ instituteId: uuid, tenantId: uuid });

// ── High-value domain schemas ─────────────────────────────────────────────────

const STUDENT_SCHEMAS = {
  'STUDENT.admitted': z.object({
    studentProfileId: uuid,
    membershipId: uuid,
    standardId: uuid,
    sectionId: uuid,
    tenantId: uuid,
  }),
  'STUDENT.enrolled': z.object({
    studentProfileId: uuid,
    academicYearId: uuid,
    sectionId: uuid,
    tenantId: uuid,
  }),
  'STUDENT.left': z.object({
    studentProfileId: uuid,
    reason: str,
    tcNumber: str.nullable(),
    tenantId: uuid,
  }),
  'STUDENT.promoted': z.object({
    studentProfileId: uuid,
    tenantId: uuid,
  }),
  'STUDENT.removed_from_year': z.object({
    studentProfileId: uuid,
    academicYearId: uuid,
    sectionId: uuid,
    reason: str,
    tenantId: uuid,
  }),
  'STUDENT.statusChanged': z.object({
    studentProfileId: uuid,
    fromStatus: str,
    toStatus: str,
    reason: str.nullable(),
    tenantId: uuid,
  }),
  'STUDENT.updated': tenantBase.catchall(z.unknown()),
  'STUDENT.section_changed': z.object({
    studentProfileId: uuid,
    oldSectionId: uuid,
    newSectionId: uuid,
    tenantId: uuid,
  }),
} as const;

const INSTITUTE_SCHEMAS = {
  'INSTITUTE.activated': instituteIdBase.extend({
    resellerId: uuid.optional(),
    previousStatus: str,
    scope: str.optional(),
  }),
  'INSTITUTE.deactivated': instituteIdBase.extend({
    previousStatus: str,
    scope: str.optional(),
    reason: str.optional(),
  }),
  'INSTITUTE.suspended': instituteIdBase.extend({
    resellerId: uuid.nullable(),
    previousStatus: str,
    reason: str.optional(),
    scope: str,
  }),
  'INSTITUTE.rejected': instituteIdBase
    .extend({
      previousStatus: str,
      reason: str.optional(),
      scope: str.optional(),
    })
    .catchall(z.unknown()),
  'INSTITUTE.approved': instituteRecordBase
    .extend({
      resellerId: uuid.nullable(),
      scope: str,
    })
    .catchall(z.unknown()),
  'INSTITUTE.approval_requested': instituteRecordBase
    .extend({
      requestedBy: uuid,
    })
    .catchall(z.unknown()),
  'INSTITUTE.updated': instituteRecordBase
    .extend({
      changedFields: z.array(str),
    })
    .catchall(z.unknown()),
  'INSTITUTE.reseller_reassigned': instituteRecordBase
    .extend({
      previousResellerId: uuid.nullable(),
      newResellerId: uuid,
    })
    .catchall(z.unknown()),
  'INSTITUTE.group_assigned': instituteRecordBase
    .extend({
      previousGroupId: uuid.nullable().optional(),
      newGroupId: uuid,
    })
    .catchall(z.unknown()),
  'INSTITUTE.group_removed': instituteRecordBase
    .extend({ previousGroupId: uuid.nullable().optional() })
    .catchall(z.unknown()),
  'INSTITUTE.status_changed': instituteRecordBase
    .extend({ previousStatus: str, newStatus: str })
    .catchall(z.unknown()),
  'INSTITUTE.created': instituteRecordBase
    .extend({
      type: str.optional(),
    })
    .catchall(z.unknown()),
  'INSTITUTE.deleted': instituteIdBase,
  'INSTITUTE.restored': instituteIdBase,
  'INSTITUTE.branding_updated': instituteIdBase.extend({
    branding: z.unknown(),
  }),
  'INSTITUTE.config_updated': instituteIdBase.extend({
    changedFields: z.array(str),
  }),
  'INSTITUTE.setup_completed': instituteIdBase,
  'INSTITUTE.setup_progress': instituteIdBase.catchall(z.unknown()),
  'INSTITUTE.setup_retry_triggered': instituteIdBase.catchall(z.unknown()),
  // Institute groups are platform-scoped (span multiple institutes), so no
  // single tenantId. The institute_added/institute_removed events carry an
  // instituteId which is the tenantId from the consumer's perspective.
  'INSTITUTE.group.activated': z.object({ id: uuid }).catchall(z.unknown()),
  'INSTITUTE.group.created': z.object({ id: uuid }).catchall(z.unknown()),
  'INSTITUTE.group.deactivated': z.object({ id: uuid }).catchall(z.unknown()),
  'INSTITUTE.group.deleted': z.object({ id: uuid }).catchall(z.unknown()),
  'INSTITUTE.group.institute_added': z
    .object({ groupId: uuid, instituteId: uuid })
    .catchall(z.unknown()),
  'INSTITUTE.group.institute_removed': z.object({ instituteId: uuid }).catchall(z.unknown()),
  'INSTITUTE.group.member_added': z.object({ groupId: uuid, userId: uuid }).catchall(z.unknown()),
  'INSTITUTE.group.member_removed': z.object({ groupId: uuid, userId: uuid }).catchall(z.unknown()),
  'INSTITUTE.group.suspended': z.object({ id: uuid }).catchall(z.unknown()),
  'INSTITUTE.group.updated': z.object({ id: uuid }).catchall(z.unknown()),
} as const;

const LEAVE_SCHEMAS = {
  'LEAVE.applied': z.object({
    leaveId: uuid,
    tenantId: uuid,
    userId: uuid,
    startDate: str,
    endDate: str,
    type: str,
  }),
  'LEAVE.updated': z.object({
    leaveId: uuid,
    tenantId: uuid,
    userId: uuid,
  }),
  'LEAVE.approved': z.object({
    leaveId: uuid,
    tenantId: uuid,
    userId: uuid,
    approverMembershipId: uuid,
  }),
  'LEAVE.rejected': z.object({
    leaveId: uuid,
    tenantId: uuid,
    userId: uuid,
    approverMembershipId: uuid,
  }),
  'LEAVE.cancelled': z.object({
    leaveId: uuid,
    tenantId: uuid,
    userId: uuid,
  }),
  'LEAVE.deleted': z.object({
    leaveId: uuid,
    tenantId: uuid,
  }),
} as const;

const APPLICATION_SCHEMAS = {
  'APPLICATION.status_changed': z.object({
    applicationId: uuid,
    oldStatus: str,
    newStatus: str,
    tenantId: uuid,
  }),
} as const;

const ACADEMIC_YEAR_SCHEMAS = {
  'ACADEMIC_YEAR.activated': z.object({
    academicYearId: uuid,
    tenantId: uuid,
    previousYearId: uuid.nullable(),
  }),
  'ACADEMIC_YEAR.archived': z.object({
    academicYearId: uuid,
    tenantId: uuid,
  }),
  'ACADEMIC_YEAR.created': z.object({
    academicYearId: uuid,
    tenantId: uuid,
    label: str,
  }),
  'ACADEMIC_YEAR.updated': z.object({
    academicYearId: uuid,
    tenantId: uuid,
    label: str,
  }),
  'ACADEMIC_YEAR.deleted': z.object({
    academicYearId: uuid,
    tenantId: uuid,
  }),
} as const;

const BILLING_SCHEMAS = {
  'BILLING.subscription.created': z.object({
    subscriptionId: uuid,
    tenantId: uuid.optional(),
    resellerId: uuid.optional(),
  }),
  'BILLING.subscription.activated': z.object({
    subscriptionId: uuid,
    tenantId: uuid.optional(),
    resellerId: uuid.optional(),
  }),
  'BILLING.subscription.paused': z.object({
    subscriptionId: uuid,
    tenantId: uuid.optional(),
    resellerId: uuid.optional(),
  }),
  'BILLING.subscription.resumed': z.object({
    subscriptionId: uuid,
    tenantId: uuid.optional(),
    resellerId: uuid.optional(),
  }),
  'BILLING.subscription.cancelled': z.object({
    subscriptionId: uuid,
    tenantId: uuid.optional(),
    resellerId: uuid.optional(),
  }),
  'BILLING.subscription.expired': z.object({
    subscriptionId: uuid,
    tenantId: uuid.optional(),
    resellerId: uuid.optional(),
  }),
  'BILLING.subscription.plan_changed': z.object({
    subscriptionId: uuid,
    tenantId: uuid,
    resellerId: uuid,
    oldPlanId: uuid,
    newPlanId: uuid,
    prorationDelta: z.unknown().optional(),
  }),
  // The three ids are what the GraphQL subscription filters match on.
  'BILLING.subscription.status_changed': z
    .object({
      subscriptionId: uuid,
      tenantId: uuid,
      resellerId: uuid,
    })
    .catchall(z.unknown()),
  'BILLING.payment.succeeded': z
    .object({
      paymentId: uuid,
      invoiceId: uuid,
      tenantId: uuid,
      resellerId: uuid,
    })
    .catchall(z.unknown()),
  'BILLING.payment.refunded': z
    .object({
      paymentId: uuid,
    })
    .catchall(z.unknown()),
  'BILLING.payment.status_changed': z
    .object({
      paymentId: uuid,
      invoiceId: uuid,
      tenantId: uuid,
      resellerId: uuid,
    })
    .catchall(z.unknown()),
  'BILLING.payment.upi_p2p_submitted': z
    .object({
      paymentId: uuid.optional(),
    })
    .catchall(z.unknown()),
  'BILLING.payment.upi_p2p_rejected': z
    .object({
      paymentId: uuid.optional(),
    })
    .catchall(z.unknown()),
  'BILLING.payment.upi_p2p_verified': z
    .object({
      paymentId: uuid.optional(),
    })
    .catchall(z.unknown()),
  'BILLING.invoice.generated': z
    .object({
      invoiceId: uuid,
      tenantId: uuid,
      resellerId: uuid,
    })
    .catchall(z.unknown()),
  'BILLING.invoice.paid': z
    .object({
      invoiceId: uuid.optional(),
    })
    .catchall(z.unknown()),
  'BILLING.plan.created': z.object({
    id: uuid,
    name: z.unknown(),
  }),
  'BILLING.plan.updated': z.object({ id: uuid }),
  'BILLING.plan.archived': z.object({ id: uuid }),
  'BILLING.plan.restored': z.object({ id: uuid }),
  'BILLING.plan.deleted': z.object({ id: uuid }),
  'BILLING.webhook.cashfree': z.object({}).catchall(z.unknown()),
  'BILLING.webhook.razorpay': z.object({}).catchall(z.unknown()),
} as const;

const AUDIT_SCHEMAS = {
  'AUDIT.log': z
    .object({
      id: uuid.optional(),
      // AuthScope — single source in `@roviq/common-types/enums/auth`.
      scope: z.enum(AUTH_SCOPE_VALUES),
      tenantId: uuid.nullable(),
      resellerId: uuid.nullable().optional(),
      subjectTenantId: uuid.nullable().optional(),
      userId: uuid,
      actorId: uuid,
      action: str,
      actionType: str,
      entityType: str,
      entityId: uuid.nullable().optional(),
      correlationId: str,
      source: str,
    })
    .catchall(z.unknown()),
} as const;

const NOTIFICATION_SCHEMAS = {
  'NOTIFICATION.leave.decided': z.object({
    leaveId: uuid,
    tenantId: uuid,
    userId: uuid,
    status: str,
    applicantName: str.nullable().optional(),
    startDate: calendarDate.optional(),
    endDate: calendarDate.optional(),
  }),
  'NOTIFICATION.approval.requested': tenantBase.catchall(z.unknown()),
  'NOTIFICATION.approval.resolved': tenantBase.catchall(z.unknown()),
  'NOTIFICATION.attendance.absent': tenantBase.catchall(z.unknown()),
  // Mirrors `AuthSecurityEvent` in `@roviq/notifications`. tenantId is
  // nullable for platform/reseller-scope auth events that have no tenant.
  'NOTIFICATION.auth.security': z.object({
    tenantId: uuid.nullable(),
    userId: uuid,
    // AuthSecurityEventType — single source in `@roviq/common-types/enums/auth`.
    eventType: z.enum(AUTH_SECURITY_EVENT_TYPE_VALUES),
    metadata: z
      .object({
        otp: z.string().optional(),
        recipientPhone: z.string().optional(),
        recipientEmail: z.string().optional(),
        purpose: z.string().optional(),
      })
      .catchall(z.unknown()),
    scope: z.enum(['platform', 'reseller', 'institute']).optional(),
    resellerId: uuid.nullable().optional(),
  }),
  // No address or recipient: the consumer reads both from its own settings. Never an institute's.
  'NOTIFICATION.canary.requested': z.object({
    channel: z.enum(NOTIFICATION_CHANNEL_VALUES),
    requestedAt: z.iso.datetime(),
    tenantId: z.null(),
  }),
  'NOTIFICATION.whatsapp_templates.sync_requested': z.object({
    providerAccountId: z.string().min(1),
    tenantId: z.null(),
  }),
  'NOTIFICATION.fee.overdue': tenantBase.catchall(z.unknown()),
  'NOTIFICATION.fee.reminder': tenantBase.catchall(z.unknown()),
  // Pointer only: the consumer reads the row as the recipient, so no text travels on NATS.
  'NOTIFICATION.inapp.created': z.object({
    notificationId: uuid,
    scope: z.enum(['platform', 'reseller', 'institute']),
    tenantId: uuid.nullable(),
    resellerId: uuid.nullable(),
    recipientUserId: uuid,
  }),
  // Pointers only: the notification service reads the row itself before it acts on either.
  'NOTIFICATION.inapp.seen': z.object({ notificationId: uuid, recipientUserId: uuid }),
  'NOTIFICATION.push.acknowledged': z.object({ notificationId: uuid, recipientUserId: uuid }),
  'NOTIFICATION.user.created': z.object({}).catchall(z.unknown()),
  'NOTIFICATION.user.updated': z.object({}).catchall(z.unknown()),
} as const;

// ── Permissive baseline schemas for remaining domains ─────────────────────────

const BOT_SCHEMAS = {
  'BOT.api_key_rotated': tenantBase.catchall(z.unknown()),
  'BOT.created': tenantBase.catchall(z.unknown()),
  'BOT.deleted': tenantBase.catchall(z.unknown()),
  'BOT.updated': tenantBase.catchall(z.unknown()),
} as const;

const ATTENDANCE_SESSION_SCHEMAS = {
  'ATTENDANCE_SESSION.bulk_marked': tenantBase.catchall(z.unknown()),
  'ATTENDANCE_SESSION.deleted': tenantBase.catchall(z.unknown()),
  'ATTENDANCE_SESSION.opened': tenantBase.catchall(z.unknown()),
  'ATTENDANCE_SESSION.overridden': tenantBase.catchall(z.unknown()),
  'ATTENDANCE_SESSION.past_day_bulk_edited': tenantBase.catchall(z.unknown()),
} as const;

const ATTENDANCE_ENTRY_SCHEMAS = {
  'ATTENDANCE_ENTRY.marked': tenantBase.catchall(z.unknown()),
  'ATTENDANCE_ENTRY.past_day_edited': tenantBase.catchall(z.unknown()),
} as const;

const CONSENT_SCHEMAS = {
  'CONSENT.given': tenantBase.catchall(z.unknown()),
  'CONSENT.withdrawn': tenantBase.catchall(z.unknown()),
} as const;

const CERTIFICATE_SCHEMAS = {
  'CERTIFICATE.generated': tenantBase.catchall(z.unknown()),
} as const;

const TC_SCHEMAS = {
  'TC.issued': tenantBase.catchall(z.unknown()),
} as const;

const exportReportBase = z.object({
  tenantId: uuid,
  exportReportId: uuid,
  reportType: z.enum(COMPLIANCE_REPORT_TYPE_VALUES),
  academicYearId: uuid,
  requestedBy: uuid,
});

const EXPORT_SCHEMAS = {
  'EXPORT.requested': exportReportBase,
  'EXPORT.completed': exportReportBase.extend({
    fileId: uuid,
    rowCount: z.number().int().nonnegative(),
  }),
  'EXPORT.failed': exportReportBase.extend({ errorCode: str }),
} as const;

const FILE_SCHEMAS = {
  'FILE.quarantined': z.object({
    // Null for a reseller's file and for a file about a person
    tenantId: uuid.nullable(),
    resellerId: uuid.nullable(),
    fileId: uuid,
    purpose: z.enum(FILE_PURPOSE_VALUES),
    uploadedBy: uuid,
    // Name the scanner gave the threat, e.g. "Win.Test.EICAR_HDB-1"
    signature: str,
  }),
} as const;

const USER_SCHEMAS = {
  'USER.admission_created': z.object({}).catchall(z.unknown()),
} as const;

const GUARDIAN_SCHEMAS = {
  'GUARDIAN.linked': tenantBase.catchall(z.unknown()),
  'GUARDIAN.unlinked': tenantBase.catchall(z.unknown()),
} as const;

const STAFF_SCHEMAS = {
  'STAFF.joined': tenantBase.catchall(z.unknown()),
  'STAFF.left': tenantBase.catchall(z.unknown()),
} as const;

const STANDARD_SCHEMAS = {
  'STANDARD.created': tenantBase.catchall(z.unknown()),
  'STANDARD.deleted': tenantBase.catchall(z.unknown()),
  'STANDARD.updated': tenantBase.catchall(z.unknown()),
} as const;

const SECTION_SCHEMAS = {
  'SECTION.capacity_warning': z.object({
    sectionId: uuid,
    currentStrength: z.number(),
    optimal: z.number(),
    tenantId: uuid,
  }),
  'SECTION.created': z.object({
    sectionId: uuid,
    tenantId: uuid,
    standardId: uuid,
  }),
  'SECTION.deleted': z.object({
    sectionId: uuid,
    tenantId: uuid,
  }),
  'SECTION.teacher_assigned': z.object({
    sectionId: uuid,
    tenantId: uuid,
    classTeacherId: uuid,
  }),
  'SECTION.updated': z.object({
    sectionId: uuid,
    tenantId: uuid,
  }),
} as const;

const SUBJECT_SCHEMAS = {
  'SUBJECT.assigned_to_section': z.object({
    subjectId: uuid,
    sectionId: uuid,
    tenantId: uuid,
  }),
  'SUBJECT.assigned_to_standard': z.object({
    subjectId: uuid,
    standardId: uuid,
    tenantId: uuid,
  }),
  'SUBJECT.created': z.object({
    subjectId: uuid,
    tenantId: uuid,
    name: z.unknown(),
  }),
  'SUBJECT.deleted': z.object({
    subjectId: uuid,
    tenantId: uuid,
  }),
  'SUBJECT.removed_from_section': z.object({
    subjectId: uuid,
    sectionId: uuid,
    tenantId: uuid,
  }),
  'SUBJECT.removed_from_standard': z.object({
    subjectId: uuid,
    standardId: uuid,
    tenantId: uuid,
  }),
  'SUBJECT.updated': z.object({
    subjectId: uuid,
    tenantId: uuid,
    name: z.unknown(),
  }),
} as const;

const GROUP_SCHEMAS = {
  'GROUP.membership_resolved': z.object({
    groupId: uuid,
    memberCount: z.number(),
    resolvedAt: z.unknown(),
    tenantId: uuid,
  }),
  'GROUP.rules_updated': z.object({
    groupId: uuid,
    tenantId: uuid,
  }),
} as const;

const HOLIDAY_SCHEMAS = {
  'HOLIDAY.created': z.object({
    holidayId: uuid,
    tenantId: uuid,
    type: str,
    startDate: str,
    endDate: str,
  }),
  'HOLIDAY.deleted': z.object({
    holidayId: uuid,
    tenantId: uuid,
  }),
  'HOLIDAY.updated': z.object({
    holidayId: uuid,
    tenantId: uuid,
  }),
} as const;

const ENQUIRY_SCHEMAS = {
  'ENQUIRY.created': tenantBase.catchall(z.unknown()),
} as const;

const RESELLER_SCHEMAS = {
  'RESELLER.created': z.object({ scope: str }).catchall(z.unknown()),
  'RESELLER.status_changed': z.object({ scope: str.optional() }).catchall(z.unknown()),
  'RESELLER.tier_changed': z.object({}).catchall(z.unknown()),
  'RESELLER.updated': z.object({ scope: str }).catchall(z.unknown()),
} as const;

const IMPERSONATION_SCHEMAS = {
  'IMPERSONATION.session_ended': z.object({
    id: uuid,
    tenantId: uuid.nullable(),
    impersonatorScope: str,
  }),
  'IMPERSONATION.session_started': z.object({ id: uuid, tenantId: uuid, impersonatorScope: str }),
} as const;

const TIMETABLE_SCHEMAS = {
  'TIMETABLE.activated': z.object({
    timetableId: uuid,
    tenantId: uuid,
    academicYearId: uuid,
    previousActiveId: uuid.nullable(),
  }),
  'TIMETABLE.archived': z.object({ timetableId: uuid, tenantId: uuid }),
  'TIMETABLE.created': z.object({
    timetableId: uuid,
    tenantId: uuid,
    academicYearId: uuid,
  }),
  'TIMETABLE.day_overridden': z.object({
    overrideId: uuid,
    timetableId: uuid,
    tenantId: uuid,
    sectionId: uuid,
    date: str,
  }),
  'TIMETABLE.deactivated': z.object({ timetableId: uuid, tenantId: uuid }),
  'TIMETABLE.deleted': z.object({ timetableId: uuid, tenantId: uuid }),
  'TIMETABLE.entry_assigned': z.object({
    timetableId: uuid,
    tenantId: uuid,
    sectionId: uuid,
    periodId: uuid,
  }),
  'TIMETABLE.entry_cleared': z.object({
    timetableId: uuid,
    tenantId: uuid,
    sectionId: uuid,
    periodId: uuid,
  }),
  'TIMETABLE.override_cleared': z.object({
    overrideId: uuid,
    timetableId: uuid,
    tenantId: uuid,
  }),
  'TIMETABLE.period_added': z.object({
    timetableId: uuid,
    tenantId: uuid,
    periodId: uuid,
  }),
  'TIMETABLE.period_removed': z.object({
    timetableId: uuid,
    tenantId: uuid,
    periodId: uuid,
  }),
  'TIMETABLE.restored': z.object({ timetableId: uuid, tenantId: uuid }),
  'TIMETABLE.section_added': z.object({
    timetableId: uuid,
    tenantId: uuid,
    sectionId: uuid,
  }),
  'TIMETABLE.section_removed': z.object({
    timetableId: uuid,
    tenantId: uuid,
    sectionId: uuid,
  }),
  'TIMETABLE.updated': z.object({ timetableId: uuid, tenantId: uuid }),
} as const;

// ── Flat map: EventPattern → ZodTypeAny ──────────────────────────────────────
//
// TypeScript can't index a nested const object with a dot-path string, so we
// build a flat Record at declaration time. Any key missing here will surface
// as an `undefined` lookup in the coverage test — the intent is every leaf
// in EVENT_PATTERNS maps to an entry below.

// @internal — `flatEventSchemas` derives from this tuple; the duplicate-key
// test in `event-schemas.spec.ts` asserts no two maps share a key.
export const _DOMAIN_SCHEMA_MAPS = [
  STUDENT_SCHEMAS,
  INSTITUTE_SCHEMAS,
  LEAVE_SCHEMAS,
  APPLICATION_SCHEMAS,
  ACADEMIC_YEAR_SCHEMAS,
  BILLING_SCHEMAS,
  AUDIT_SCHEMAS,
  NOTIFICATION_SCHEMAS,
  BOT_SCHEMAS,
  ATTENDANCE_SESSION_SCHEMAS,
  ATTENDANCE_ENTRY_SCHEMAS,
  CONSENT_SCHEMAS,
  CERTIFICATE_SCHEMAS,
  TC_SCHEMAS,
  EXPORT_SCHEMAS,
  FILE_SCHEMAS,
  USER_SCHEMAS,
  GUARDIAN_SCHEMAS,
  STAFF_SCHEMAS,
  STANDARD_SCHEMAS,
  SECTION_SCHEMAS,
  SUBJECT_SCHEMAS,
  GROUP_SCHEMAS,
  HOLIDAY_SCHEMAS,
  ENQUIRY_SCHEMAS,
  RESELLER_SCHEMAS,
  IMPERSONATION_SCHEMAS,
  TIMETABLE_SCHEMAS,
] as const;

// Intersection preserves per-key → specific-schema mapping so `EventPayload<P>`
// resolves correctly. Widening to `Record<string, ZodTypeAny>` collapses it to any.
type UnionToIntersection<U> = (U extends unknown ? (k: U) => void : never) extends (
  k: infer I,
) => void
  ? I
  : never;
type FlatEventSchemas = UnionToIntersection<(typeof _DOMAIN_SCHEMA_MAPS)[number]>;

const _flatEventSchemas: FlatEventSchemas = Object.assign({}, ..._DOMAIN_SCHEMA_MAPS);

export const flatEventSchemas: Record<string, z.ZodTypeAny> = _flatEventSchemas;

export type EventPayload<P extends EventPattern> = P extends keyof FlatEventSchemas
  ? z.infer<FlatEventSchemas[P]>
  : Record<string, unknown>;

/** `flatEventSchemas` keyed by subject with each schema's own type, for consumers to `.parse()`. */
export const eventPayloadSchemas: FlatEventSchemas = _flatEventSchemas;
