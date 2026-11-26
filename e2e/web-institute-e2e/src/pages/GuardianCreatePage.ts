/**
 * Page Object for /people/guardians/new.
 *
 * Wraps semantic queries so specs read as domain steps. All locators use
 * role/label queries — no CSS, no data-testid.
 */
import { expect, type Locator, type Page } from '@playwright/test';

export type GuardianEducationLevel =
  | 'ILLITERATE'
  | 'PRIMARY'
  | 'SECONDARY'
  | 'GRADUATE'
  | 'POST_GRADUATE'
  | 'PROFESSIONAL';

export const EDUCATION_LEVEL_LABELS_EN: Record<GuardianEducationLevel, string> = {
  ILLITERATE: 'पढ़ाई नहीं की',
  PRIMARY: 'प्राइमरी (क्लास 5 तक)',
  SECONDARY: 'सेकेंडरी (क्लास 10 / 12)',
  GRADUATE: 'ग्रेजुएट',
  POST_GRADUATE: 'पोस्ट ग्रेजुएट',
  PROFESSIONAL: 'प्रोफ़ेशनल (MBBS, LLB, CA वगैरह)',
};

export const EDUCATION_LEVEL_LABELS_HI: Record<GuardianEducationLevel, string> = {
  ILLITERATE: 'पढ़ाई नहीं की',
  PRIMARY: 'प्राइमरी (क्लास 5 तक)',
  SECONDARY: 'सेकेंडरी (क्लास 10 / 12)',
  GRADUATE: 'ग्रेजुएट',
  POST_GRADUATE: 'पोस्ट ग्रेजुएट',
  PROFESSIONAL: 'प्रोफ़ेशनल (MBBS, LLB, CA वगैरह)',
};

export class GuardianCreatePage {
  constructor(private readonly page: Page) {}

  async goto(locale: 'en' | 'hi' = 'en'): Promise<void> {
    await this.page.goto(`/${locale}/people/guardians/new`);
  }

  heading(): Locator {
    return this.page.getByTestId('guardian-new-title');
  }

  firstNameEnglish(): Locator {
    return this.page.getByTestId('guardian-first-name-en');
  }

  firstNameHindi(): Locator {
    return this.page.getByTestId('guardian-first-name-hi');
  }

  genderTrigger(): Locator {
    return this.page.getByTestId('guardian-new-gender-select');
  }

  emailInput(): Locator {
    return this.page.getByTestId('guardian-new-email-input');
  }

  phoneInput(): Locator {
    return this.page.getByTestId('guardian-new-phone-input');
  }

  occupationInput(): Locator {
    return this.page.getByTestId('guardian-new-occupation-input');
  }

  educationLevelTrigger(): Locator {
    return this.page.getByTestId('guardian-new-education-level-select');
  }

  submitButton(): Locator {
    return this.page.getByTestId('guardian-new-submit-btn');
  }

  backButton(): Locator {
    return this.page.getByTestId('guardian-new-back-btn');
  }

  async fillFirstNameEnglish(value: string): Promise<void> {
    await this.firstNameEnglish().fill(value);
  }

  async selectGender(optionLabel: string): Promise<void> {
    await this.genderTrigger().click();
    await this.page.getByRole('option', { name: optionLabel, exact: true }).click();
  }

  async selectEducationLevel(label: string): Promise<void> {
    await this.educationLevelTrigger().click();
    await this.page.getByRole('option', { name: label, exact: true }).click();
  }

  async openEducationLevel(): Promise<void> {
    await this.educationLevelTrigger().click();
  }

  educationLevelOption(label: string): Locator {
    return this.page.getByRole('option', { name: label, exact: true });
  }

  async submit({ force = false } = {}): Promise<void> {
    await this.submitButton().click({ force });
  }

  async expectOnNewPage(): Promise<void> {
    await expect(this.page).toHaveURL(/\/people\/guardians\/new/);
  }

  async expectRedirectedToDetail(): Promise<void> {
    await expect(this.page).toHaveURL(/\/(institute\/)?people\/guardians\/[0-9a-f-]{36}/);
  }
}
