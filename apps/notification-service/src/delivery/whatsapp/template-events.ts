import { z } from 'zod';
import type { TemplateEventChange } from '../../repositories/messaging-template.repository';
import { templateCategoryOf, templateStatusOf } from './whatsapp-template.client';

/** One provider event about one template of one account, reduced to the change it makes. */
export interface TemplateEvent {
  providerAccountId: string;
  name: string;
  language: string;
  field: TemplateField;
  change: TemplateEventChange;
}

/** The webhook fields about templates (ROV-333); every other field is not this module's. */
export const TEMPLATE_FIELDS = [
  'message_template_status_update',
  'template_category_update',
  'message_template_quality_update',
  'message_template_components_update',
  'template_correct_category_detection',
] as const;
export type TemplateField = (typeof TEMPLATE_FIELDS)[number];

const isTemplateField = (f: string | undefined): f is TemplateField =>
  TEMPLATE_FIELDS.some((t) => t === f);

const valueSchema = z.looseObject({
  event: z.string().optional(),
  message_template_id: z.union([z.string(), z.number()]).optional(),
  message_template_name: z.string().min(1),
  message_template_language: z.string().min(1),
  message_template_category: z.string().optional(),
  reason: z.string().nullish(),
  new_category: z.string().optional(),
  correct_category: z.string().optional(),
  new_quality_score: z.string().optional(),
});

const payloadSchema = z.looseObject({
  entry: z
    .array(
      z.looseObject({
        id: z.string().min(1),
        changes: z
          .array(z.looseObject({ field: z.string().optional(), value: z.unknown() }))
          .optional(),
      }),
    )
    .optional(),
});

function changeOf(field: TemplateField, v: z.infer<typeof valueSchema>): TemplateEventChange {
  switch (field) {
    case 'message_template_status_update': {
      const status = templateStatusOf(v.event);
      const category = templateCategoryOf(v.message_template_category);
      return {
        status,
        rejectedReason: status === 'REJECTED' && v.reason && v.reason !== 'NONE' ? v.reason : null,
        ...(status === 'APPROVED' && category !== null ? { approvedCategory: category } : {}),
      };
    }
    case 'template_category_update': {
      const category = templateCategoryOf(v.new_category);
      return category === null ? {} : { approvedCategory: category };
    }
    case 'message_template_quality_update':
      return v.new_quality_score ? { quality: v.new_quality_score } : {};
    case 'message_template_components_update':
      // The text was changed at the provider: shown and alerted, never overwritten here.
      return { outOfStep: true };
    case 'template_correct_category_detection': {
      const suggested = v.correct_category ?? v.new_category;
      return suggested ? { suggestedCategory: suggested } : {};
    }
  }
}

/**
 * The template events of a webhook body. The account is the entry's id. Anything not understood
 * is dropped, never thrown on: the provider adds fields without notice.
 */
export function parseTemplateEvents(body: unknown): TemplateEvent[] {
  const payload = payloadSchema.safeParse(body);
  if (!payload.success) return [];
  const events: TemplateEvent[] = [];
  for (const entry of payload.data.entry ?? []) {
    for (const { field, value } of entry.changes ?? []) {
      if (!isTemplateField(field)) continue;
      const v = valueSchema.safeParse(value);
      if (!v.success) continue;
      events.push({
        providerAccountId: entry.id,
        name: v.data.message_template_name,
        language: v.data.message_template_language,
        field,
        change: changeOf(field, v.data),
      });
    }
  }
  return events;
}
