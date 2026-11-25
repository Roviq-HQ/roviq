import { defineFieldHelp } from '@roviq/ui';

export const instituteInfoHelp = defineFieldHelp('instituteSettings.info', {
  identifiers: {
    title: { en: 'Regulatory identifiers', hi: 'नियामक पहचान संख्या' },
    body: {
      en: 'Government codes recorded for your institute, such as the UDISE+ code and the Shala Darpan ID. The Shala Darpan export prints both, and a Shala Darpan ID makes that export available. They cannot be edited on this page.',
      hi: 'आपके संस्थान के लिए दर्ज सरकारी कोड, जैसे UDISE+ कोड और शाला दर्पण ID। शाला दर्पण एक्सपोर्ट दोनों को छापता है, और शाला दर्पण ID होने पर वह एक्सपोर्ट उपलब्ध होता है। इन्हें इस पेज पर बदला नहीं जा सकता।',
    },
  },
  affiliations: {
    title: { en: 'Board affiliations', hi: 'बोर्ड संबद्धता' },
    body: {
      en: 'The boards your institute is affiliated to. The board and affiliation number are printed in the letterhead of certificates. Affiliations that are not revoked decide which board exports you can generate, such as CBSE registration and LOC, or the BSEH staff statement. They cannot be edited on this page.',
      hi: 'वे बोर्ड जिनसे आपका संस्थान संबद्ध है। बोर्ड और संबद्धता संख्या प्रमाणपत्रों के लेटरहेड में छपती है। जो संबद्धता रद्द नहीं हुई, उनसे तय होता है कि आप कौन से बोर्ड एक्सपोर्ट बना सकते हैं, जैसे CBSE पंजीकरण और LOC, या BSEH स्टाफ विवरण। इन्हें इस पेज पर बदला नहीं जा सकता।',
    },
  },
});
