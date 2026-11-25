import type { AdmissionType, SocialCategory } from '@roviq/common-types';
import { defineFieldHelp, helpOptions } from '@roviq/ui';

export const studentNewHelp = defineFieldHelp('students.new', {
  socialCategory: {
    title: { en: 'Social category', hi: 'कैटेगरी (सामाजिक वर्ग)' },
    body: {
      en: "The student's government category. It is printed on the TC and in the UDISE+, Shala Darpan and admission register exports.",
      hi: 'स्टूडेंट की सरकारी कैटेगरी। यह TC पर और UDISE+, शाला दर्पण व एडमिशन रजिस्टर के एक्सपोर्ट में छपती है।',
    },
    points: [
      {
        en: "Pick what is written on the student's caste certificate.",
        hi: 'स्टूडेंट के कास्ट सर्टिफिकेट पर जो लिखा है, वही चुनें।',
      },
      {
        en: 'Not sure? Leave it blank and fill it in later.',
        hi: 'पता नहीं है? खाली छोड़ दें, बाद में भर सकते हैं।',
      },
    ],
    options: helpOptions<SocialCategory>({
      GENERAL: { en: 'No reserved category', hi: 'कोई रिज़र्वेशन नहीं' },
      OBC: { en: 'Other Backward Class', hi: 'अन्य पिछड़ा वर्ग' },
      SC: { en: 'Scheduled Caste', hi: 'अनुसूचित जाति' },
      ST: { en: 'Scheduled Tribe', hi: 'अनुसूचित जनजाति' },
      EWS: {
        en: 'Economically Weaker Section (General category, low family income)',
        hi: 'आर्थिक रूप से कमज़ोर वर्ग (General कैटेगरी, कम आय वाला परिवार)',
      },
    }),
  },
  academicYear: {
    title: { en: 'Academic year', hi: 'शैक्षणिक वर्ष' },
    body: {
      en: 'The session the student joins. The standard and section lists show the standards and sections of this session, and changing it clears both. The current session is marked active.',
      hi: 'वह सत्र जिसमें विद्यार्थी प्रवेश लेता है। कक्षा और अनुभाग की सूची इसी सत्र की कक्षाएँ और अनुभाग दिखाती है, और इसे बदलने पर दोनों खाली हो जाते हैं। वर्तमान सत्र सक्रिय के रूप में दिखता है।',
    },
    example: {
      en: 'Admitting in June 2025: 2025-26. Admitting in March 2026 for the session that starts in April: 2026-27.',
      hi: 'जून 2025 में प्रवेश: 2025-26। अप्रैल से शुरू होने वाले सत्र के लिए मार्च 2026 में प्रवेश: 2026-27।',
    },
  },
  admissionType: {
    title: { en: 'Admission type', hi: 'एडमिशन टाइप' },
    hint: { en: 'Left blank, New is saved.', hi: 'खाली छोड़ने पर नया एडमिशन सेव होता है।' },
    body: {
      en: 'How the student joined your institute. It is printed in the admission register export.',
      hi: 'स्टूडेंट आपके संस्थान में कैसे आया। यह एडमिशन रजिस्टर के एक्सपोर्ट में छपता है।',
    },
    points: [
      {
        en: 'Pick the way the student actually came.',
        hi: 'स्टूडेंट जिस तरह सच में आया, वही चुनें।',
      },
    ],
    options: helpOptions<AdmissionType>({
      NEW: { en: 'First time at your institute', hi: 'आपके संस्थान में पहली बार' },
      LATERAL_ENTRY: {
        en: 'Joining in the middle of the session, from another institute',
        hi: 'सेशन के बीच में दूसरे संस्थान से आया',
      },
      RE_ADMISSION: {
        en: 'Left your institute earlier and is now coming back',
        hi: 'पहले आपका संस्थान छोड़ चुका था, अब वापस आ रहा है',
      },
      TRANSFER: {
        en: 'Coming from another institute with a TC',
        hi: 'दूसरे संस्थान से TC लेकर आया',
      },
    }),
  },
});
