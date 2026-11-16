import { createMongoAbility } from '@casl/ability';
import type { AbilityRequestContext } from '@roviq/casl';
import { substituteUserVars } from '@roviq/casl';
import { type AppAbility, DEFAULT_ROLE_ABILITIES, type DefaultRole } from '@roviq/common-types';
import { mkInstituteCtx } from '@roviq/database';
import { createMock } from '@roviq/testing';
import { GraphQLID, GraphQLObjectType, type GraphQLResolveInfo } from 'graphql';
import { describe, expect, it } from 'vitest';
import { readFieldMiddleware, redactSensitiveJson } from '../read-field.middleware';

function abilityFor(role: DefaultRole) {
  return createMongoAbility<AppAbility>(
    DEFAULT_ROLE_ABILITIES[role].map((rule) => ({
      ...rule,
      ...(rule.conditions
        ? {
            conditions: substituteUserVars(rule.conditions, {
              userId: 'own-user',
              assignedSections: ['own-section'],
              linkedStudentIds: ['own-student'],
            }),
          }
        : {}),
    })),
  );
}

async function read(role: DefaultRole, field: string, value: unknown) {
  const context: AbilityRequestContext = {
    req: { user: mkInstituteCtx('tenant', 'test:read-fields'), ability: abilityFor(role) },
  };
  return readFieldMiddleware(
    {
      source: { id: 'own-student', userId: 'own-user', currentSectionId: 'own-section' },
      context,
      args: {},
      info: createMock<GraphQLResolveInfo>({
        fieldName: field,
        parentType: new GraphQLObjectType({
          name: 'StudentModel',
          fields: { id: { type: GraphQLID } },
        }),
      }),
    },
    async () => value,
  );
}

describe('student read field authorization', () => {
  it.each<DefaultRole>([
    'principal',
    'class_teacher',
    'student',
    'parent',
    'receptionist',
    'support_staff',
  ])('%s cannot read medical information', async (role) => {
    expect(await read(role, 'medicalInfo', { conditions: ['confidential'] })).toBeNull();
  });
  it.each<DefaultRole>([
    'institute_admin',
    'admin_clerk',
    'nurse',
    'counselor',
  ])('%s retains medical access', async (role) => {
    expect(await read(role, 'medicalInfo', { conditions: ['allergy'] })).toEqual({
      conditions: ['allergy'],
    });
  });
  it('support staff sees names but not admission numbers', async () => {
    expect(await read('support_staff', 'firstName', { en: 'Test' })).toEqual({ en: 'Test' });
    expect(await read('support_staff', 'admissionNumber', 'ADM-1')).toBeNull();
  });
  it('receptionist sees admission numbers but not birth dates', async () => {
    expect(await read('receptionist', 'admissionNumber', 'ADM-1')).toBe('ADM-1');
    expect(await read('receptionist', 'dateOfBirth', '2014-01-01')).toBeNull();
  });
  it('redacts nested identity, income, medical and counselor values for principal', () => {
    expect(
      redactSensitiveJson(
        {
          aadhaar: '1234',
          annual_income: '50000',
          medicalInfo: { allergies: ['x'] },
          nested: { counselorNotes: 'secret', firstName: 'Visible' },
          identifiers: [
            { type: 'PAN', value: 'ABCDE1234F' },
            { type: 'APAAR', value: 'allowed' },
          ],
        },
        abilityFor('principal'),
      ),
    ).toEqual({
      aadhaar: '1234',
      nested: { firstName: 'Visible' },
      identifiers: [
        { type: 'PAN', value: 'ABCDE1234F' },
        { type: 'APAAR', value: 'allowed' },
      ],
    });
  });
  it('keeps admin/clerk identity and income permissions unchanged', () => {
    for (const role of ['institute_admin', 'admin_clerk'] as const) {
      expect(
        redactSensitiveJson(
          { aadhaar: '1234', pan: 'ABCDE1234F', annualIncome: 50000 },
          abilityFor(role),
        ),
      ).toEqual({ aadhaar: '1234', pan: 'ABCDE1234F', annualIncome: 50000 });
    }
  });
});
