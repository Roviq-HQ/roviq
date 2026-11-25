import { createHash } from 'node:crypto';
import type { MessageTemplateCategory } from '@roviq/common-types';
import { deliveryCanaryWhatsApp } from '../../types/delivery-canary.type';
import { LOCALES, type Locale } from '../../types/notification-type';
import type { RegularTypeKey } from '../../types/registry';
import type { WhatsAppTemplate } from './whatsapp-template';
import { WHATSAPP_TEMPLATES } from './whatsapp-templates';

/** Exactly what the provider is asked to approve for one template in one language. */
export interface TemplateSubmission {
  name: string;
  language: Locale;
  category: MessageTemplateCategory;
  body: string;
  /** Example values for `{{1}}`, `{{2}}`, … in order. */
  bodyExamples: string[];
  buttonLabel: string;
  /** The portal address followed by `/{{1}}`. */
  buttonUrl: string;
  /** A full address the button could open, for the provider's review. */
  buttonExample: string;
  /** Changes with the approved content; not with the examples or the portal address. */
  contentHash: string;
}

/** The portal address the button opens is not a public `https` address the provider accepts. */
export class TemplatePortalUrlError extends Error {
  constructor(reason: string) {
    super(`INSTITUTE_PORTAL_URL cannot carry a WhatsApp template button: ${reason}`);
    this.name = 'TemplatePortalUrlError';
  }
}

const PRIVATE_HOST =
  /^(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|\[?::1\]?|0\.0\.0\.0)$/;
const PRIVATE_SUFFIX = /\.(localhost|local|test|internal|lan|home|example)$/;

/** The portal address without a trailing slash, or a `TemplatePortalUrlError`. */
export function publicPortalUrl(value: string | undefined): string {
  if (!value) throw new TemplatePortalUrlError('it is not set');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TemplatePortalUrlError('it is not an address');
  }
  if (url.protocol !== 'https:') throw new TemplatePortalUrlError('it is not https');
  const host = url.hostname.toLowerCase();
  if (PRIVATE_HOST.test(host) || PRIVATE_SUFFIX.test(host) || !host.includes('.')) {
    throw new TemplatePortalUrlError(`${host} is not a public host`);
  }
  if (url.search || url.hash) throw new TemplatePortalUrlError('it has a query or a fragment');
  return url.toString().replace(/\/+$/, '');
}

/** What a submission's hash covers: the parts the provider approves. */
export function contentHashOf(parts: {
  category: MessageTemplateCategory;
  body: string;
  buttonLabel: string;
}): string {
  const canonical = JSON.stringify([parts.category, parts.body, parts.buttonLabel, '{{1}}']);
  return createHash('sha256').update(canonical).digest('hex');
}

export function toSubmission<P>(
  template: WhatsAppTemplate<P>,
  language: Locale,
  portalUrl: string,
): TemplateSubmission {
  const body = template.body[language];
  const buttonLabel = template.buttonLabel[language];
  return {
    name: template.name,
    language,
    category: template.category,
    body,
    bodyExamples: template.variables(template.example, language),
    buttonLabel,
    buttonUrl: `${portalUrl}/{{1}}`,
    buttonExample: `${portalUrl}/${template.buttonPath(template.example)}`,
    contentHash: contentHashOf({ category: template.category, body, buttonLabel }),
  };
}

/** One registered template with its params type erased: what the sync needs of it. */
export interface RegisteredTemplate {
  name: string;
  category: MessageTemplateCategory;
  contentHash(language: Locale): string;
  submission(language: Locale, portalUrl: string): TemplateSubmission;
}

function registered<P>(template: WhatsAppTemplate<P>): RegisteredTemplate {
  return {
    name: template.name,
    category: template.category,
    contentHash: (language) =>
      contentHashOf({
        category: template.category,
        body: template.body[language],
        buttonLabel: template.buttonLabel[language],
      }),
    submission: (language, portalUrl) => toSubmission(template, language, portalUrl),
  };
}

function templatesOf<K extends RegularTypeKey>(key: K): RegisteredTemplate[] {
  const entry = WHATSAPP_TEMPLATES[key];
  if (!entry) return [];
  return entry.digest
    ? [registered(entry.single), registered(entry.digest)]
    : [registered(entry.single)];
}

/** Every template the code may send, the canary's included; each name once. */
export function registeredTemplates(): RegisteredTemplate[] {
  const keys = Object.keys(WHATSAPP_TEMPLATES) as RegularTypeKey[];
  const all = [registered(deliveryCanaryWhatsApp), ...keys.flatMap(templatesOf)];
  const seen = new Set<string>();
  return all.filter((t) => !seen.has(t.name) && seen.add(t.name));
}

/** Every template in every language, ready to submit. */
export function registrySubmissions(portalUrl: string): TemplateSubmission[] {
  return registeredTemplates().flatMap((t) =>
    LOCALES.map((language) => t.submission(language, portalUrl)),
  );
}

/** One hash over the whole registry: the service syncs again at start when it changes. */
export function registryHash(): string {
  const parts = registeredTemplates()
    .flatMap((t) => LOCALES.map((l) => `${t.name}:${l}:${t.contentHash(l)}`))
    .sort();
  return createHash('sha256').update(parts.join('\n')).digest('hex');
}
