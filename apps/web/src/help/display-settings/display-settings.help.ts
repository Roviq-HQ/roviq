import { defineFieldHelp } from '@roviq/ui';

/** The sample field in Display settings, so people see what each form help mode shows. */
export const displaySettingsHelp = defineFieldHelp('displaySettings', {
  sampleAdmissionNumber: {
    title: { en: 'Admission number', hi: 'प्रवेश संख्या' },
    hint: {
      en: 'Leave it blank to get the next number automatically.',
      hi: 'अगली संख्या अपने आप पाने के लिए इसे खाली छोड़ें।',
    },
    body: {
      en: 'The number printed on the admission register, the ID card and the transfer certificate. Leave it blank and the institute’s next number in the series is used.',
      hi: 'वह संख्या जो प्रवेश रजिस्टर, पहचान पत्र और स्थानांतरण प्रमाणपत्र पर छपती है। इसे खाली छोड़ने पर संस्थान की श्रृंखला की अगली संख्या लगती है।',
    },
    example: { en: 'ADM/2025/0142', hi: 'ADM/2025/0142' },
  },
});
