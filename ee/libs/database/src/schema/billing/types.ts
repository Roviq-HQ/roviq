/** Defines what a subscription plan grants to an institute. Stored as JSONB on plans. */
export interface PlanEntitlements {
  /** Maximum number of students allowed. null = unlimited */
  maxStudents: number | null;
  /** Maximum number of staff members allowed. null = unlimited */
  maxStaff: number | null;
  /** Maximum file storage in megabytes. null = unlimited */
  maxStorageMb: number | null;
  /** How many days audit log entries are retained before archival (e.g., 90, 365, 1095) */
  auditLogRetentionDays: number;
  /** Feature flags enabled by this plan (e.g., 'advanced_timetable', 'bulk_sms', 'custom_reports') */
  features: string[];
}

/** A single line item on an invoice. Stored as JSONB array on invoices. */
export interface InvoiceLineItem {
  /** Human-readable description of the charge (e.g., "Pro Plan — March 2026") */
  description: string;
  /** Number of units billed */
  quantity: number;
  /** Price per unit in paise, serialized as string because JSONB cannot hold native bigint */
  unitAmountPaise: string;
  /** Total before tax in paise (quantity × unitAmountPaise), serialized as string */
  totalAmountPaise: string;
  /** Tax percentage applied (e.g., 18 for 18% GST) */
  taxRate: number;
  /** Tax amount in paise, serialized as string */
  taxAmountPaise: string;
  /** SAC (Services Accounting Code) for GST compliance (e.g., "998393" for education services) */
  sacCode?: string;
}
