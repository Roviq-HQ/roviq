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
  channels: ['WHATSAPP', 'EMAIL', 'PUSH'],
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
        body:
          locale === 'hi'
            ? `स्वीकृति आवश्यक: ${p.requesterName} ने ${p.approvalType} अनुरोध भेजा है। ${p.summary}`
            : `Approval needed: ${p.requesterName} submitted a ${p.approvalType} request. ${p.summary}`,
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
  channels: ['WHATSAPP', 'EMAIL', 'PUSH'],
  digest: null,
  inAppCopy: (p) => ({
    title: localized((l) => resolvedTitle(p, l)),
    body: localized((l) => resolvedLine(p, l)),
    data: { approvalType: p.approvalType, status: p.status, path: approvalPath(p.approvalType) },
  }),
  outsideCopy: (p, _channel, locale) => ({
    subject: resolvedTitle(p, locale),
    body: resolvedLine(p, locale),
  }),
};
