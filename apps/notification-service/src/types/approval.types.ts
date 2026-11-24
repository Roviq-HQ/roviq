import { MessageTemplateCategory } from '@roviq/common-types';
import { buttonPathOf, clipVariable } from '../delivery/whatsapp/template-variables';
import {
  cleanVariable,
  renderTemplate,
  type WhatsAppTemplate,
} from '../delivery/whatsapp/whatsapp-template';
import type { TypeTemplates } from '../delivery/whatsapp/whatsapp-templates';
import { defineFlow, step } from './flow';
import { type Locale, localized, type RegularNotificationType } from './notification-type';

export interface ApprovalRequestedParams {
  approvalType: string;
  requesterName: string;
  summary: string;
  entityId: string;
}

export interface ApprovalResolvedParams {
  approvalType: string;
  status: 'APPROVED' | 'REJECTED';
  reviewerName: string;
  remarks: string | null;
}

function approvalPath(approvalType: string): string {
  return approvalType === 'LEAVE' ? '/institute/leave' : '/institute/dashboard';
}

const FREE_TEXT_MAX = 200;
const NONE: Record<Locale, string> = { en: 'none', hi: 'कोई नहीं' };

/** The approved body closes the sentence itself. */
function freeText(value: string | null, locale: Locale): string {
  return clipVariable((value ?? '').trim().replace(/[.।]+$/, ''), FREE_TEXT_MAX, NONE[locale]);
}

const requestedWhatsApp: WhatsAppTemplate<ApprovalRequestedParams> = {
  name: 'approval_requested_v1',
  category: MessageTemplateCategory.UTILITY,
  body: {
    en: 'Approval needed: {{1}} submitted a {{2}} request. Summary: {{3}}. Open Roviq to review it.',
    hi: 'स्वीकृति आवश्यक: {{1}} ने {{2}} अनुरोध भेजा है। सारांश: {{3}}। समीक्षा के लिए Roviq खोलें।',
  },
  variables: (p, locale) => [
    cleanVariable(p.requesterName, locale === 'hi' ? 'एक सदस्य' : 'a member'),
    cleanVariable(p.approvalType, locale === 'hi' ? 'नया' : 'new'),
    freeText(p.summary, locale),
  ],
  buttonPath: (p) => buttonPathOf(approvalPath(p.approvalType)),
};

export const approvalRequestedWhatsApp: TypeTemplates<ApprovalRequestedParams> = {
  single: requestedWhatsApp,
};

const requestedTitle = (p: ApprovalRequestedParams, locale: Locale) =>
  locale === 'hi' ? `स्वीकृति आवश्यक: ${p.approvalType}` : `Approval Needed: ${p.approvalType}`;

const requestedLine = (p: ApprovalRequestedParams, locale: Locale) =>
  locale === 'hi'
    ? `${p.requesterName} ने ${p.approvalType} अनुरोध भेजा है: ${p.summary}`
    : `${p.requesterName} submitted a ${p.approvalType} request: ${p.summary}`;

export const approvalRequestedType: RegularNotificationType<ApprovalRequestedParams> = {
  key: 'APPROVAL_REQUESTED',
  secret: false,
  settingsCategory: 'APPROVAL',
  critical: false,
  flow: defineFlow({ steps: [step.parallel(['WHATSAPP', 'EMAIL', 'PUSH'])] }),
  digest: null,
  inAppCopy: (p) => ({
    title: localized((l) => requestedTitle(p, l)),
    body: localized((l) => requestedLine(p, l)),
    data: {
      entityId: p.entityId,
      approvalType: p.approvalType,
      path: approvalPath(p.approvalType),
    },
  }),
  outsideCopy: (p, channel, locale) => {
    if (channel === 'WHATSAPP') {
      return {
        subject: requestedTitle(p, locale),
        body: renderTemplate(
          requestedWhatsApp.body[locale],
          requestedWhatsApp.variables(p, locale),
        ),
      };
    }
    if (channel === 'PUSH') {
      return { subject: requestedTitle(p, locale), body: `${p.requesterName} — ${p.summary}` };
    }
    return { subject: requestedTitle(p, locale), body: `${requestedLine(p, locale)}.` };
  },
};

function resolvedWord(status: ApprovalResolvedParams['status'], locale: Locale): string {
  if (locale === 'hi') return status === 'APPROVED' ? 'स्वीकृत' : 'अस्वीकृत';
  return status === 'APPROVED' ? 'approved' : 'rejected';
}

const resolvedTitle = (p: ApprovalResolvedParams, locale: Locale) =>
  locale === 'hi'
    ? `${p.approvalType} अनुरोध ${resolvedWord(p.status, locale)}`
    : `${p.approvalType} request ${resolvedWord(p.status, locale)}`;

const resolvedWhatsApp: WhatsAppTemplate<ApprovalResolvedParams> = {
  name: 'approval_resolved_v1',
  category: MessageTemplateCategory.UTILITY,
  body: {
    en: 'Request update: the {{1}} request, reviewed by {{2}}, was {{3}}. Remarks: {{4}}. Open Roviq to see the details.',
    hi: 'अनुरोध अपडेट: {{1}} अनुरोध की समीक्षा {{2}} ने की और इसे {{3}} किया गया। टिप्पणी: {{4}}। विवरण के लिए Roviq खोलें।',
  },
  variables: (p, locale) => [
    cleanVariable(p.approvalType, locale === 'hi' ? 'प्रस्तुत' : 'submitted'),
    cleanVariable(p.reviewerName, locale === 'hi' ? 'समीक्षक' : 'the reviewer'),
    resolvedWord(p.status, locale),
    freeText(p.remarks, locale),
  ],
  buttonPath: (p) => buttonPathOf(approvalPath(p.approvalType)),
};

export const approvalResolvedWhatsApp: TypeTemplates<ApprovalResolvedParams> = {
  single: resolvedWhatsApp,
};

function resolvedLine(p: ApprovalResolvedParams, locale: Locale): string {
  const word = resolvedWord(p.status, locale);
  if (locale === 'hi') {
    const remarks = p.remarks ? ` टिप्पणी: ${p.remarks}` : '';
    return `${p.approvalType} अनुरोध ${p.reviewerName} द्वारा ${word} किया गया।${remarks}`;
  }
  const remarks = p.remarks ? ` Remarks: ${p.remarks}` : '';
  return `${p.approvalType} request was ${word} by ${p.reviewerName}.${remarks}`;
}

export const approvalResolvedType: RegularNotificationType<ApprovalResolvedParams> = {
  key: 'APPROVAL_RESOLVED',
  secret: false,
  settingsCategory: 'APPROVAL',
  critical: false,
  flow: defineFlow({ steps: [step.parallel(['WHATSAPP', 'EMAIL', 'PUSH'])] }),
  digest: null,
  inAppCopy: (p) => ({
    title: localized((l) => resolvedTitle(p, l)),
    body: localized((l) => resolvedLine(p, l)),
    data: { approvalType: p.approvalType, status: p.status, path: approvalPath(p.approvalType) },
  }),
  outsideCopy: (p, channel, locale) => ({
    subject: resolvedTitle(p, locale),
    body:
      channel === 'WHATSAPP'
        ? renderTemplate(resolvedWhatsApp.body[locale], resolvedWhatsApp.variables(p, locale))
        : resolvedLine(p, locale),
  }),
};
