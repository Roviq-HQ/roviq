import { defineFieldHelp } from '@roviq/ui';

/** The sample field in Display settings, so people see what each form help mode shows. */
export const displaySettingsHelp = defineFieldHelp('displaySettings', {
  sampleAdmissionNumber: {
    title: { en: 'Admission number', hi: 'एडमिशन नंबर' },
    hint: {
      en: 'Leave it blank to get the next number automatically.',
      hi: 'अगला नंबर अपने आप पाने के लिए इसे खाली छोड़ें।',
    },
    body: {
      en: 'The number printed on the admission register, the ID card and the transfer certificate.',
      hi: 'वह नंबर जो एडमिशन रजिस्टर, ID कार्ड और TC पर छपता है।',
    },
    points: [
      {
        en: "Leave it blank and the institute's next number in the series is used.",
        hi: 'खाली छोड़ने पर संस्थान की सीरीज़ का अगला नंबर लग जाता है।',
      },
    ],
    example: { en: 'ADM/2025/0142', hi: 'ADM/2025/0142' },
  },
});
