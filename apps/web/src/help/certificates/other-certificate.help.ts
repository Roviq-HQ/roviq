import { defineFieldHelp } from '@roviq/ui';

export const otherCertificateHelp = defineFieldHelp('certificates.other', {
  template: {
    title: { en: 'Template', hi: 'टेम्पलेट' },
    body: {
      en: "Your institute's active templates for this certificate type, by name.",
      hi: 'इस तरह के सर्टिफिकेट के लिए आपके संस्थान के ऐक्टिव टेम्पलेट, नाम से।',
    },
    points: [
      {
        en: "The template sets the certificate's wording and which details are filled in from the student's record.",
        hi: 'टेम्पलेट से सर्टिफिकेट के शब्द तय होते हैं, और स्टूडेंट के रिकॉर्ड से कौन सी जानकारी भरी जाएगी।',
      },
      {
        en: 'Those details are listed below once you choose one.',
        hi: 'टेम्पलेट चुनने पर वह जानकारी नीचे दिखती है।',
      },
      {
        en: 'Templates cannot be added or changed here.',
        hi: 'यहाँ टेम्पलेट जोड़े या बदले नहीं जा सकते।',
      },
    ],
  },
  purpose: {
    title: { en: 'Purpose', hi: 'मकसद' },
    body: {
      en: 'Printed on the certificate as the purpose it is issued for, so the office receiving it can see what it was meant for.',
      hi: 'सर्टिफिकेट पर छपता है कि यह किस काम के लिए जारी हुआ, ताकि लेने वाला दफ़्तर देख सके।',
    },
    points: [
      {
        en: 'Name the actual use rather than "official purposes".',
        hi: '"सरकारी काम" जैसा आम शब्द नहीं, असली इस्तेमाल लिखें।',
      },
    ],
    example: {
      en: 'Railway concession pass renewal; passport application.',
      hi: 'रेलवे कन्सेशन पास रिन्यू करना; पासपोर्ट ऐप्लिकेशन।',
    },
  },
});
