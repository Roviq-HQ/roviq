import { defineFieldHelp } from '@roviq/ui';

export const otherCertificateHelp = defineFieldHelp('certificates.other', {
  template: {
    title: { en: 'Template', hi: 'टेम्पलेट' },
    body: {
      en: "Your institute's active templates for this certificate type, by name. The template sets the certificate's wording and which details are filled in from the student's record; they are listed below once you choose one. Templates cannot be added or changed here.",
      hi: 'इस प्रमाणपत्र प्रकार के आपके संस्थान के सक्रिय टेम्पलेट, नाम से। टेम्पलेट से प्रमाणपत्र के शब्द तय होते हैं, और विद्यार्थी के रिकॉर्ड से कौन से विवरण भरे जाएँगे; टेम्पलेट चुनने पर वे नीचे दिखते हैं। टेम्पलेट यहाँ जोड़े या बदले नहीं जा सकते।',
    },
  },
  purpose: {
    title: { en: 'Purpose', hi: 'उद्देश्य' },
    body: {
      en: 'Printed on the certificate as the purpose it is issued for, so the office receiving it can see what it was meant for. Name the actual use rather than "official purposes".',
      hi: 'प्रमाणपत्र पर उस उद्देश्य के रूप में छपता है जिसके लिए यह जारी हुआ, ताकि इसे पाने वाला कार्यालय देख सके कि यह किस लिए है। "आधिकारिक उद्देश्य" के बजाय असली उपयोग लिखें।',
    },
    example: {
      en: 'Railway concession pass renewal; passport application.',
      hi: 'रेलवे रियायत पास नवीनीकरण; पासपोर्ट आवेदन।',
    },
  },
});
