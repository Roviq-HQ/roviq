// libs/database/src/seed/demo/institutes.ts

import {
  instituteAffiliations,
  instituteBranding,
  instituteConfigs,
  instituteIdentifiers,
  instituteNotificationConfigs,
  institutes,
  SYSTEM_USER_ID,
} from '../..';
import type { DrizzleDB } from '../../providers';
import { SEED_NAMES, SEED_SLUGS } from '../fixtures';
import { SEED_IDS } from '../ids';

const BY = { createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID };

export async function seedInstitutes(tx: DrizzleDB) {
  const [inst1] = await tx
    .insert(institutes)
    .values({
      id: SEED_IDS.INSTITUTE_1,
      name: SEED_NAMES.INSTITUTE_1,
      slug: SEED_SLUGS.INSTITUTE_1,
      code: 'SVM-GGN-01',
      type: 'SCHOOL',
      structureFramework: 'NEP',
      status: 'ACTIVE',
      setupStatus: 'COMPLETED',
      isDemo: false,
      departments: ['PRE_PRIMARY', 'PRIMARY', 'UPPER_PRIMARY', 'SECONDARY', 'SENIOR_SECONDARY'],
      timezone: 'Asia/Kolkata',
      currency: 'INR',
      contact: {
        phones: [
          {
            countryCode: '+91',
            number: '9876543210',
            isPrimary: true,
            isWhatsappEnabled: true,
            label: 'Office',
          },
          {
            countryCode: '+91',
            number: '0124-2345678',
            isPrimary: false,
            isWhatsappEnabled: false,
            label: 'Landline',
          },
        ],
        emails: [
          { address: 'info@svm-ggn.edu.in', isPrimary: true, label: 'General' },
          { address: 'principal@svm-ggn.edu.in', isPrimary: false, label: 'Principal' },
        ],
      },
      address: {
        line1: '12, Sector 14',
        line2: 'Near Civil Hospital',
        city: 'Gurugram',
        district: 'Gurugram',
        state: 'HARYANA',
        postalCode: '122001',
        country: 'IN',
        coordinates: { lat: 28.4595, lng: 77.0266 },
      },
      settings: { supportedLocales: ['en', 'hi'] },
      ...BY,
    })
    .onConflictDoUpdate({
      target: institutes.slug,
      set: { status: 'ACTIVE', setupStatus: 'COMPLETED', updatedAt: new Date() },
    })
    .returning();

  const [inst2] = await tx
    .insert(institutes)
    .values({
      id: SEED_IDS.INSTITUTE_2,
      name: SEED_NAMES.INSTITUTE_2,
      slug: SEED_SLUGS.INSTITUTE_2,
      code: 'RPS-JPR-01',
      type: 'SCHOOL',
      structureFramework: 'TRADITIONAL',
      status: 'ACTIVE',
      setupStatus: 'COMPLETED',
      isDemo: false,
      departments: ['PRIMARY', 'UPPER_PRIMARY', 'SECONDARY'],
      timezone: 'Asia/Kolkata',
      currency: 'INR',
      contact: {
        phones: [
          {
            countryCode: '+91',
            number: '9412345678',
            isPrimary: true,
            isWhatsappEnabled: true,
            label: 'Office',
          },
        ],
        emails: [{ address: 'office@rps-jaipur.edu.in', isPrimary: true, label: 'General' }],
      },
      address: {
        line1: '45, Jawahar Nagar',
        line2: 'Near Statue Circle',
        city: 'Jaipur',
        district: 'Jaipur',
        state: 'RAJASTHAN',
        postalCode: '302004',
        country: 'IN',
        coordinates: { lat: 26.9124, lng: 75.7873 },
      },
      settings: { supportedLocales: ['en', 'hi'] },
      ...BY,
    })
    .onConflictDoUpdate({
      target: institutes.slug,
      set: { status: 'ACTIVE', setupStatus: 'COMPLETED', updatedAt: new Date() },
    })
    .returning();

  return { inst1, inst2 };
}

export async function seedBrandingAndConfigs(tx: DrizzleDB, inst1Id: string, inst2Id: string) {
  const now = new Date();
  const startYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;

  // Branding
  await tx
    .insert(instituteBranding)
    .values([
      {
        id: SEED_IDS.BRANDING_INST1,
        tenantId: inst1Id,
        primaryColor: '#1E40AF',
        secondaryColor: '#F59E0B',
        themeIdentifier: 'royal-blue',
        ...BY,
      },
      {
        id: SEED_IDS.BRANDING_INST2,
        tenantId: inst2Id,
        primaryColor: '#059669',
        secondaryColor: '#DC2626',
        themeIdentifier: 'emerald',
        ...BY,
      },
    ])
    .onConflictDoNothing();

  // Configs
  await tx
    .insert(instituteConfigs)
    .values({
      id: SEED_IDS.CONFIG_INST1,
      tenantId: inst1Id,
      attendanceType: 'DAILY',
      openingTime: '07:30',
      closingTime: '14:00',
      shifts: [{ name: 'Morning', start: '07:30', end: '14:00' }],
      termStructure: [
        { label: 'Term 1', startDate: `${startYear}-04-01`, endDate: `${startYear}-09-30` },
        { label: 'Term 2', startDate: `${startYear}-10-01`, endDate: `${startYear + 1}-03-31` },
      ],
      gradingSystem: {
        type: 'CBSE_CCE',
        scales: [
          { grade: 'A1', minPercent: 91, maxPercent: 100, gpa: 10.0 },
          { grade: 'A2', minPercent: 81, maxPercent: 90, gpa: 9.0 },
          { grade: 'B1', minPercent: 71, maxPercent: 80, gpa: 8.0 },
          { grade: 'B2', minPercent: 61, maxPercent: 70, gpa: 7.0 },
          { grade: 'C1', minPercent: 51, maxPercent: 60, gpa: 6.0 },
          { grade: 'C2', minPercent: 41, maxPercent: 50, gpa: 5.0 },
          { grade: 'D', minPercent: 33, maxPercent: 40, gpa: 4.0 },
          { grade: 'E', minPercent: 0, maxPercent: 32, gpa: 0.0 },
        ],
      },
      sectionStrengthNorms: { optimal: 40, hardMax: 45, exemptionAllowed: true },
      admissionNumberConfig: {
        format: '{prefix}{year}/{value:04d}',
        year_format: 'YYYY',
        prefixes: { '-3': 'N-', '-2': 'L-', '-1': 'U-', '1': 'A-' },
        no_prefix_from_class: 2,
      },
      ...BY,
    })
    .onConflictDoNothing();

  await tx
    .insert(instituteConfigs)
    .values({
      id: SEED_IDS.CONFIG_INST2,
      tenantId: inst2Id,
      attendanceType: 'DAILY',
      openingTime: '08:00',
      closingTime: '14:30',
      shifts: [{ name: 'Morning', start: '08:00', end: '14:30' }],
      termStructure: [
        { label: 'First Half', startDate: `${startYear}-04-01`, endDate: `${startYear}-09-30` },
        {
          label: 'Second Half',
          startDate: `${startYear}-10-01`,
          endDate: `${startYear + 1}-03-31`,
        },
      ],
      gradingSystem: { type: 'PERCENTAGE', passingPercent: 33 },
      sectionStrengthNorms: { optimal: 45, hardMax: 50, exemptionAllowed: false },
      admissionNumberConfig: {
        format: 'RPS/{year}/{value:04d}',
        year_format: 'YY-YY',
        prefixes: {},
        no_prefix_from_class: 1,
      },
      ...BY,
    })
    .onConflictDoNothing();
}

export async function seedIdentifiersAndAffiliations(
  tx: DrizzleDB,
  inst1Id: string,
  inst2Id: string,
) {
  await tx
    .insert(instituteIdentifiers)
    .values([
      {
        id: SEED_IDS.IDENTIFIER_UDISE_INST1,
        tenantId: inst1Id,
        type: 'UDISE_PLUS',
        value: '06130100501',
        issuingAuthority: 'Ministry of Education',
        ...BY,
      },
      {
        id: SEED_IDS.IDENTIFIER_CBSE_AFF_INST1,
        tenantId: inst1Id,
        type: 'CBSE_AFFILIATION',
        value: '530456',
        issuingAuthority: 'CBSE New Delhi',
        validFrom: '2020-04-01',
        validTo: '2030-03-31',
        ...BY,
      },
      {
        id: SEED_IDS.IDENTIFIER_UDISE_INST2,
        tenantId: inst2Id,
        type: 'UDISE_PLUS',
        value: '08220200301',
        issuingAuthority: 'Ministry of Education',
        ...BY,
      },
      {
        id: SEED_IDS.IDENTIFIER_BSEH_AFF_INST2,
        tenantId: inst2Id,
        type: 'BSEH_AFFILIATION',
        value: 'BSEH-1234',
        issuingAuthority: 'Board of School Education Haryana',
        validFrom: '2019-07-01',
        validTo: '2029-06-30',
        ...BY,
      },
    ])
    .onConflictDoNothing();

  await tx
    .insert(instituteAffiliations)
    .values([
      {
        id: SEED_IDS.AFFILIATION_CBSE_INST1,
        tenantId: inst1Id,
        board: 'CBSE',
        affiliationStatus: 'REGULAR',
        affiliationNumber: '530456',
        grantedLevel: 'Senior Secondary (Class XII)',
        validFrom: '2020-04-01',
        validTo: '2030-03-31',
        ...BY,
      },
      {
        id: SEED_IDS.AFFILIATION_BSEH_INST2,
        tenantId: inst2Id,
        board: 'BSEH',
        affiliationStatus: 'REGULAR',
        affiliationNumber: 'BSEH-1234',
        grantedLevel: 'Secondary (Class X)',
        validFrom: '2019-07-01',
        validTo: '2029-06-30',
        ...BY,
      },
    ])
    .onConflictDoNothing();
}

export async function seedNotificationConfigs(tx: DrizzleDB, instituteIds: string[]) {
  const notificationTypes = ['FEE', 'ATTENDANCE', 'APPROVAL'] as const;
  for (const instId of instituteIds) {
    for (const type of notificationTypes) {
      await tx
        .insert(instituteNotificationConfigs)
        .values({
          tenantId: instId,
          notificationType: type,
          inAppEnabled: true,
          whatsappEnabled: true,
          emailEnabled: true,
          pushEnabled: false,
          digestEnabled: false,
          ...BY,
        })
        .onConflictDoUpdate({
          target: [
            instituteNotificationConfigs.tenantId,
            instituteNotificationConfigs.notificationType,
          ],
          set: { updatedAt: new Date() },
        });
    }
  }
}
