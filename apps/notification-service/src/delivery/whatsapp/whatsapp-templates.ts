import { approvalRequestedWhatsApp, approvalResolvedWhatsApp } from '../../types/approval.types';
import { attendanceAbsentWhatsApp } from '../../types/attendance-absent.type';
import { authNewDeviceWhatsApp, authPasswordResetWhatsApp } from '../../types/auth-security.types';
import type { RegularDigest, RegularMessage } from '../../types/compose';
import { feeOverdueWhatsApp, feeReminderWhatsApp } from '../../types/fee.types';
import type { Locale } from '../../types/notification-type';
import type { RegularParamsMap, RegularTypeKey } from '../../types/registry';
import { type TemplateSend, toTemplateSend, type WhatsAppTemplate } from './whatsapp-template';

export interface TypeTemplates<P> {
  single: WhatsAppTemplate<P>;
  /** Present exactly when the type has a digest: one summary for several items. */
  digest?: WhatsAppTemplate<readonly P[]>;
}

/** The approved template of every regular type that may send on WhatsApp. */
export const WHATSAPP_TEMPLATES: {
  [K in RegularTypeKey]?: TypeTemplates<RegularParamsMap[K]>;
} = {
  ATTENDANCE_ABSENT: attendanceAbsentWhatsApp,
  FEE_OVERDUE: feeOverdueWhatsApp,
  FEE_REMINDER: feeReminderWhatsApp,
  APPROVAL_REQUESTED: approvalRequestedWhatsApp,
  APPROVAL_RESOLVED: approvalResolvedWhatsApp,
  AUTH_PASSWORD_RESET: authPasswordResetWhatsApp,
  AUTH_NEW_DEVICE: authNewDeviceWhatsApp,
};

/** null when the type has no approved template. */
export function whatsappTemplateFor<K extends RegularTypeKey>(
  message: RegularMessage<K>,
  locale: Locale,
): TemplateSend | null {
  const templates = WHATSAPP_TEMPLATES[message.type];
  return templates ? toTemplateSend(templates.single, message.params, locale) : null;
}

/** A digest of one item uses the single template; of several, the digest template. null when none. */
export function whatsappDigestTemplateFor<K extends RegularTypeKey>(
  digest: RegularDigest<K>,
  locale: Locale,
): TemplateSend | null {
  const templates = WHATSAPP_TEMPLATES[digest.type];
  if (!templates) return null;
  const [first] = digest.items;
  if (digest.items.length === 1 && first) return toTemplateSend(templates.single, first, locale);
  return templates.digest ? toTemplateSend(templates.digest, digest.items, locale) : null;
}
