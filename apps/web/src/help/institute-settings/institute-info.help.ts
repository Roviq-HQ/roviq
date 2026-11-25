import { defineFieldHelp } from '@roviq/ui';

export const instituteInfoHelp = defineFieldHelp('instituteSettings.info', {
  identifiers: {
    title: { en: 'Regulatory identifiers', hi: 'सरकारी आईडी' },
    body: {
      en: 'Government codes recorded for your institute, such as the UDISE+ code and the Shala Darpan ID.',
      hi: 'आपके संस्थान के लिए दर्ज सरकारी कोड, जैसे UDISE+ कोड और शाला दर्पण ID।',
    },
    points: [
      {
        en: 'The Shala Darpan export prints both.',
        hi: 'शाला दर्पण एक्सपोर्ट में दोनों छपते हैं।',
      },
      {
        en: 'A Shala Darpan ID makes that export available.',
        hi: 'शाला दर्पण ID होने पर ही वह एक्सपोर्ट मिलता है।',
      },
      {
        en: 'They cannot be edited on this page.',
        hi: 'इस पेज पर इन्हें बदला नहीं जा सकता।',
      },
    ],
  },
  affiliations: {
    title: { en: 'Board affiliations', hi: 'बोर्ड अफ़िलिएशन' },
    body: {
      en: 'The boards your institute is affiliated to. The board and affiliation number are printed in the letterhead of certificates.',
      hi: 'वे बोर्ड जिनसे आपका संस्थान जुड़ा है। बोर्ड और अफ़िलिएशन नंबर सर्टिफिकेट के लेटरहेड में छपता है।',
    },
    points: [
      {
        en: 'Affiliations that are not revoked decide which board exports you can generate.',
        hi: 'जो अफ़िलिएशन रद्द नहीं हुई, उनसे तय होता है कि आप कौन से बोर्ड एक्सपोर्ट बना सकते हैं।',
      },
      {
        en: 'Such exports are the CBSE registration and LOC, or the BSEH staff statement.',
        hi: 'जैसे CBSE रजिस्ट्रेशन और LOC, या BSEH स्टाफ स्टेटमेंट।',
      },
      {
        en: 'They cannot be edited on this page.',
        hi: 'इस पेज पर इन्हें बदला नहीं जा सकता।',
      },
    ],
  },
});
