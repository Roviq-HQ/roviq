/**
 * Consent enums (DPDP Act): what a guardian consents to, and how their identity was checked.
 * Stored in `consent_records.purpose` and `consent_records.verification_method`.
 */

// ─── ConsentPurpose ─────────────────────────────────────────────────────────
// Each purpose needs its own, specific consent (DPDP Section 6).

export const CONSENT_PURPOSE_VALUES = [
  // Grades, attendance, enrolment (Fourth Schedule exempt)
  'ACADEMIC_DATA_PROCESSING',
  // Website, social media, brochures (explicit consent)
  'PHOTO_VIDEO_MARKETING',
  // WhatsApp messages to the guardian
  'WHATSAPP_COMMUNICATION',
  // SMS alerts to the guardian
  'SMS_COMMUNICATION',
  // Collecting and storing an Aadhaar number (sensitive data)
  'AADHAAR_COLLECTION',
  // Fingerprint or face recognition (highest sensitivity)
  'BIOMETRIC_COLLECTION',
  // Sharing data with EdTech tools (cross-entity sharing)
  'THIRD_PARTY_EDTECH',
  // Sharing with an examination board (regulatory compliance)
  'BOARD_EXAM_REGISTRATION',
  // GPS tracking on the commute to the institute (child safety)
  'TRANSPORT_TRACKING',
  // Medical records and health data
  'HEALTH_DATA_PROCESSING',
  // Campus CCTV surveillance
  'CCTV_MONITORING',
] as const;

export type ConsentPurpose = (typeof CONSENT_PURPOSE_VALUES)[number];
export const ConsentPurpose = Object.fromEntries(CONSENT_PURPOSE_VALUES.map((v) => [v, v])) as {
  readonly [K in ConsentPurpose]: K;
};

// ─── ConsentVerificationMethod ──────────────────────────────────────────────
// How the guardian's identity was verified for a consent action.

export const CONSENT_VERIFICATION_METHOD_VALUES = [
  // The guardian authenticated through DigiLocker
  'DIGILOCKER_TOKEN',
  // Verified with a UIDAI Aadhaar OTP
  'AADHAAR_OTP',
  // An institute admin checked a physical ID (Aadhaar, PAN, Voter ID)
  'IN_PERSON_ID_CHECK',
  // A scanned, signed consent form was uploaded
  'SIGNED_FORM_UPLOADED',
  // The guardian's phone is verified by OTP in Roviq (column is varchar(30): exactly fits)
  'INSTITUTE_ERP_VERIFIED_ACCOUNT',
] as const;

export type ConsentVerificationMethod = (typeof CONSENT_VERIFICATION_METHOD_VALUES)[number];
export const ConsentVerificationMethod = Object.fromEntries(
  CONSENT_VERIFICATION_METHOD_VALUES.map((v) => [v, v]),
) as { readonly [K in ConsentVerificationMethod]: K };
