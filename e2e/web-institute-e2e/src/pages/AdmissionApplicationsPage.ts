/**
 * Page Object for /admission/applications — row actions plus the reject and
 * approve dialogs.
 */

import type { Locator, Page } from '@playwright/test';
import { AdmissionApplicationStatus } from '@roviq/common-types';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { instituteGraphql } from '../../../shared/api-client';
import { SEED } from '../../../shared/seed-fixtures';

const { instituteAdmissionApplications } = testIds;

const TO_FEE_PAID = [
  AdmissionApplicationStatus.DOCUMENTS_PENDING,
  AdmissionApplicationStatus.DOCUMENTS_VERIFIED,
  AdmissionApplicationStatus.OFFER_MADE,
  AdmissionApplicationStatus.OFFER_ACCEPTED,
  AdmissionApplicationStatus.FEE_PENDING,
  AdmissionApplicationStatus.FEE_PAID,
] as const;

export class AdmissionApplicationsPage {
  constructor(private readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto('/en/institute/admission/applications');
    await this.page.getByTestId(instituteAdmissionApplications.title).waitFor();
  }

  /** Creates a SUBMITTED application in the first class that has a section. */
  async createApplication(studentName: string): Promise<string> {
    const academicYearId = SEED.ACADEMIC_YEAR_INST1.id;
    const { standards } = await instituteGraphql<{ standards: Array<{ id: string }> }>(
      this.page,
      `query Standards($academicYearId: ID!) { standards(academicYearId: $academicYearId) { id } }`,
      { academicYearId },
    );
    for (const standard of standards) {
      const { sections } = await instituteGraphql<{ sections: Array<{ id: string }> }>(
        this.page,
        `query Sections($standardId: ID!) { sections(standardId: $standardId) { id } }`,
        { standardId: standard.id },
      );
      if (sections.length === 0) continue;
      const { createApplication } = await instituteGraphql<{ createApplication: { id: string } }>(
        this.page,
        `mutation CreateApp($input: CreateApplicationInput!) { createApplication(input: $input) { id } }`,
        {
          input: {
            academicYearId,
            standardId: standard.id,
            formData: { studentName, parentPhone: `9${String(Date.now()).slice(-9)}` },
          },
        },
      );
      return createApplication.id;
    }
    throw new Error('Seed has no class with a section');
  }

  async advanceToFeePaid(applicationId: string): Promise<void> {
    for (const status of TO_FEE_PAID) {
      await instituteGraphql(
        this.page,
        `mutation Update($id: ID!, $input: UpdateApplicationInput!) { updateApplication(id: $id, input: $input) { id } }`,
        { id: applicationId, input: { status } },
      );
    }
  }

  statusBadge(applicationId: string): Locator {
    return this.page.getByTestId(`application-status-${applicationId}`);
  }

  changeStatusButton(applicationId: string): Locator {
    return this.page.getByTestId(`application-status-btn-${applicationId}`);
  }

  rejectButton(applicationId: string): Locator {
    return this.page.getByTestId(`application-reject-btn-${applicationId}`);
  }

  rejectionReason(applicationId: string): Locator {
    return this.page.getByTestId(instituteAdmissionApplications.rejectionReason(applicationId));
  }

  approveConfirmButton(): Locator {
    return this.page.getByTestId(instituteAdmissionApplications.approveConfirmBtn);
  }

  async reject(applicationId: string, reason: string): Promise<void> {
    await this.rejectButton(applicationId).click();
    await this.page.getByTestId(instituteAdmissionApplications.rejectReasonInput).fill(reason);
    await this.page.getByTestId(instituteAdmissionApplications.rejectConfirmBtn).click();
  }

  async openApproveDialog(applicationId: string): Promise<void> {
    await this.page.getByTestId(`application-approve-btn-${applicationId}`).click();
    await this.page.getByTestId(instituteAdmissionApplications.approveDialog).waitFor();
  }

  async chooseFirstSection(): Promise<void> {
    await this.page.getByTestId(instituteAdmissionApplications.approveSectionSelect).click();
    await this.page.getByRole('option').first().click();
  }
}
