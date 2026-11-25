import { defineFieldHelp } from '@roviq/ui';

export const otherCertificateHelp = defineFieldHelp('certificates.other', {
  template: {
    title: { en: 'Template ID', hi: 'टेम्पलेट आईडी' },
    body: {
      en: "The ID of one of your institute's certificate templates. It sets the certificate type and wording, and which details are filled in from the student's record; they are listed below once the template is found. Templates cannot be changed here.",
      hi: 'आपके संस्थान के किसी प्रमाणपत्र टेम्पलेट की ID। इससे प्रमाणपत्र का प्रकार और शब्द तय होते हैं, और विद्यार्थी के रिकॉर्ड से कौन से विवरण भरे जाएँगे; टेम्पलेट मिलने पर वे नीचे दिखते हैं। टेम्पलेट यहाँ नहीं बदले जा सकते।',
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
