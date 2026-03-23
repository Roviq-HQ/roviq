import { z } from 'zod';

// ── Institute Phone ──────────────────────────────────────

export const institutePhoneSchema = z.object({
  /** Country calling code (e.g., "+91" for India) */
  countryCode: z.string().min(1).max(5),
  /** Phone number digits only — 10 digits for Indian numbers */
  number: z.string().min(4).max(15),
  /** Whether this is the institute's primary contact number */
  isPrimary: z.boolean(),
  /** Whether WhatsApp messages can be sent to this number */
  isWhatsappEnabled: z.boolean(),
  /** Descriptive label (e.g., "Reception", "Principal", "Accounts") */
  label: z.string().min(1).max(100),
});

// ── Institute Email ──────────────────────────────────────

export const instituteEmailSchema = z.object({
  /** Email address */
  address: z.string().max(320),
  /** Whether this is the institute's primary email */
  isPrimary: z.boolean(),
  /** Descriptive label (e.g., "Admin", "Admissions", "Accounts") */
  label: z.string().min(1).max(100),
});

// ── Institute Contact (JSONB) ────────────────────────────

export const instituteContactSchema = z
  .object({
    phones: z.array(institutePhoneSchema),
    emails: z.array(instituteEmailSchema),
  })
  .refine((contact) => contact.phones.filter((p) => p.isPrimary).length === 1, {
    message: 'Exactly one phone must be marked as primary',
  })
  .refine((contact) => contact.phones.some((p) => p.isWhatsappEnabled), {
    message: 'At least one phone must have WhatsApp enabled',
  })
  .refine(
    (contact) =>
      contact.phones.filter((p) => p.countryCode === '+91').every((p) => /^\d{10}$/.test(p.number)),
    { message: 'Indian phone numbers (+91) must be exactly 10 digits' },
  );

// ── Institute Address (JSONB) ────────────────────────────

export const instituteAddressSchema = z.object({
  /** Primary address line */
  line1: z.string().min(1).max(255),
  /** Secondary address line (optional) */
  line2: z.string().max(255).optional(),
  /** Tertiary address line (optional) */
  line3: z.string().max(255).optional(),
  /** City name */
  city: z.string().min(1).max(100),
  /** District — essential for UDISE+ and Shala Darpan government reporting */
  district: z.string().min(1).max(100),
  /** State or union territory */
  state: z.string().min(1).max(100),
  /** PIN code (6 digits for India) */
  postalCode: z.string().min(1).max(20),
  /** ISO country code or country name */
  country: z.string().min(1).max(100),
  /** GPS coordinates for OASIS compliance (optional) */
  coordinates: z
    .object({
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
    })
    .optional(),
});

// ── Section Strength Norms (JSONB) ───────────────────────

export const sectionStrengthNormsSchema = z.object({
  /** Ideal number of students per section (e.g., 40 for CBSE) */
  optimal: z.number().int().min(1),
  /** Absolute maximum students allowed per section */
  hardMax: z.number().int().min(1),
  /** Whether the institute can request exemptions to exceed hardMax */
  exemptionAllowed: z.boolean(),
});
