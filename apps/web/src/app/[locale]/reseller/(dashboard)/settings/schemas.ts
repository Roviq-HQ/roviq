import {
  findForbiddenCustomCss,
  INDIAN_STATE_VALUES,
  optionalAddressSchema,
  RESELLER_BRAND_COLOR_RE,
  RESELLER_BRANDING_THEME_VALUES,
  RESELLER_CUSTOM_CSS_MAX_LENGTH,
} from '@roviq/common-types';
import { z } from 'zod';

const phoneSchema = z.object({
  countryCode: z.string().default('+91'),
  number: z.string().regex(/^\d{10}$/),
  isPrimary: z.boolean().default(false),
  isWhatsappEnabled: z.boolean().default(false),
  label: z.string().max(50).default(''),
});

const emailSchema = z.object({
  address: z.string().email(),
  isPrimary: z.boolean().default(false),
  label: z.string().max(50).default(''),
});

export const resellerProfileSchema = z.object({
  name: z.string().trim().min(2).max(255),
  registrationNumber: z.string().max(50).default(''),
  registrationState: z.enum(INDIAN_STATE_VALUES).optional(),
  contact: z.object({
    phones: z.array(phoneSchema).default([]),
    emails: z.array(emailSchema).default([]),
  }),
  address: optionalAddressSchema,
});

export type ResellerProfileFormValues = z.input<typeof resellerProfileSchema>;

export interface BrandingMessages {
  colorInvalid: string;
  customCssTooLong: string;
  customCssForbidden: (token: string) => string;
}

/** An empty colour means "use the default"; the stylesheet rules are the server's. */
export function createResellerBrandingSchema(messages: BrandingMessages) {
  const color = z
    .string()
    .refine((v) => v === '' || RESELLER_BRAND_COLOR_RE.test(v), messages.colorInvalid);
  return z.object({
    primaryColor: color,
    secondaryColor: color,
    theme: z.enum(RESELLER_BRANDING_THEME_VALUES),
    customCss: z
      .string()
      .max(RESELLER_CUSTOM_CSS_MAX_LENGTH, messages.customCssTooLong)
      .superRefine((css, ctx) => {
        const token = findForbiddenCustomCss(css);
        if (token) ctx.addIssue({ code: 'custom', message: messages.customCssForbidden(token) });
      }),
  });
}

export type ResellerBrandingFormValues = z.input<ReturnType<typeof createResellerBrandingSchema>>;

export const DEFAULT_PRIMARY_COLOR = '#1677FF';
export const DEFAULT_SECONDARY_COLOR = '#F1F5F9';
