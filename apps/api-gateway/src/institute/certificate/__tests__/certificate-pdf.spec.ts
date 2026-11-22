import { describe, expect, it } from 'vitest';
import { fillCertificateBody } from '../certificate-pdf.service';

describe('fillCertificateBody', () => {
  it('fills placeholders and splits paragraphs', () => {
    const body = fillCertificateBody(
      'This is to certify that {{ studentName }} studies in class {{class}}.\n\nPurpose: {{purpose}}.',
      { studentName: 'Asha Verma', class: 5, purpose: 'Passport' },
    );

    expect(body).toEqual([
      'This is to certify that Asha Verma studies in class 5.',
      'Purpose: Passport.',
    ]);
  });

  it('drops markup and turns block endings into paragraph breaks', () => {
    const body = fillCertificateBody(
      '<p>Certified: <b>{{studentName}}</b></p><p>Issued for <i>{{purpose}}</i>.</p>',
      { studentName: 'Asha', purpose: 'bank account' },
    );

    expect(body).toEqual(['Certified: Asha', 'Issued for bank account.']);
  });

  it('prints nothing for a placeholder without a text or number value', () => {
    const body = fillCertificateBody('Name: {{studentName}} {{missing}} {{nested}}', {
      studentName: 'Asha',
      nested: { a: 1 },
    });

    expect(body).toEqual(['Name: Asha']);
  });
});
