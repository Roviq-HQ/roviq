/**
 * createSection accepts the batch status the section form sends (it was missing from
 * CreateSectionInput, so every section created from the UI failed with a 400).
 */
import { BatchStatus } from '@roviq/common-types';
import {
  createInstituteToken,
  createIntegrationApp,
  createTestInstitute,
  gqlRequest,
  type IntegrationAppResult,
} from '@roviq/testing/integration';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../../app/app.module';

describe('createSection (integration)', () => {
  let result: IntegrationAppResult;
  let token: string;
  let academicYearId: string;
  let standardId: string;

  beforeAll(async () => {
    result = await createIntegrationApp({ modules: [AppModule] });
    const institute = await createTestInstitute(result.db);
    token = createInstituteToken({
      sub: institute.userId,
      tenantId: institute.tenantId,
      membershipId: institute.membershipId,
      roleId: institute.roleId,
    });
    const year = await gqlRequest<{ createAcademicYear: { id: string } }>(result.httpServer, {
      query: `mutation ($input: CreateAcademicYearInput!) { createAcademicYear(input: $input) { id } }`,
      token,
      variables: { input: { label: '2026-27', startDate: '2026-04-01', endDate: '2027-03-31' } },
    });
    expect(year.errors).toBeUndefined();
    academicYearId = year.data?.createAcademicYear.id ?? '';
    const standard = await gqlRequest<{ createStandard: { id: string } }>(result.httpServer, {
      query: `mutation ($input: CreateStandardInput!) { createStandard(input: $input) { id } }`,
      token,
      variables: { input: { academicYearId, name: { en: 'Class 3' }, numericOrder: 3 } },
    });
    expect(standard.errors).toBeUndefined();
    standardId = standard.data?.createStandard.id ?? '';
  });

  afterAll(async () => {
    await result?.close();
  });

  it('should store the batch status given on create', async () => {
    const response = await gqlRequest<{ createSection: { batchStatus: BatchStatus } }>(
      result.httpServer,
      {
        query: `mutation ($input: CreateSectionInput!) { createSection(input: $input) { batchStatus } }`,
        token,
        variables: {
          input: {
            standardId,
            academicYearId,
            name: { en: 'A' },
            displayLabel: '3-A',
            batchStatus: BatchStatus.ACTIVE,
          },
        },
      },
    );

    expect(response.errors).toBeUndefined();
    expect(response.data?.createSection.batchStatus).toBe(BatchStatus.ACTIVE);
  });
});
