import type { AdmissionType, SocialCategory } from '@roviq/common-types';
import { defineFieldHelp, helpOptions } from '@roviq/ui';

export const studentNewHelp = defineFieldHelp('students.new', {
  socialCategory: {
    title: { en: 'Social category', hi: 'सामाजिक श्रेणी' },
    body: {
      en: "The student's government classification. It is printed on the transfer certificate and in the UDISE+, Shala Darpan and admission register exports. Pick the category on the student's certificate; leave it blank if you do not know it yet.",
      hi: 'विद्यार्थी का सरकारी वर्गीकरण। यह स्थानांतरण प्रमाणपत्र पर और UDISE+, शाला दर्पण व प्रवेश रजिस्टर एक्सपोर्ट में छपता है। विद्यार्थी के प्रमाणपत्र वाली श्रेणी चुनें; पता न हो तो अभी खाली छोड़ें।',
    },
    options: helpOptions<SocialCategory>({
      GENERAL: { en: 'No reservation category.', hi: 'कोई आरक्षण श्रेणी नहीं।' },
      OBC: { en: 'Other Backward Class.', hi: 'अन्य पिछड़ा वर्ग।' },
      SC: { en: 'Scheduled Caste.', hi: 'अनुसूचित जाति।' },
      ST: { en: 'Scheduled Tribe.', hi: 'अनुसूचित जनजाति।' },
      EWS: { en: 'Economically Weaker Section.', hi: 'आर्थिक रूप से कमज़ोर वर्ग।' },
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
    title: { en: 'Admission type', hi: 'प्रवेश प्रकार' },
    hint: { en: 'Left blank, New is saved.', hi: 'खाली छोड़ने पर नया सहेजा जाता है।' },
    body: {
      en: 'How the student joined your institute. It is printed in the admission register export. Pick the route the student actually came by.',
      hi: 'विद्यार्थी आपके संस्थान में कैसे आया। यह प्रवेश रजिस्टर एक्सपोर्ट में छपता है। वही मार्ग चुनें जिससे विद्यार्थी वास्तव में आया।',
    },
    options: helpOptions<AdmissionType>({
      NEW: { en: 'Joining your institute for the first time.', hi: 'आपके संस्थान में पहली बार प्रवेश।' },
      LATERAL_ENTRY: {
        en: 'Joining mid-session from another institute.',
        hi: 'किसी अन्य संस्थान से सत्र के बीच में प्रवेश।',
      },
      RE_ADMISSION: {
        en: 'A student who left your institute and is coming back.',
        hi: 'आपका संस्थान छोड़ चुका विद्यार्थी, जो वापस आ रहा है।',
      },
      TRANSFER: {
        en: 'Joining with a transfer certificate from another institute.',
        hi: 'किसी अन्य संस्थान के स्थानांतरण प्रमाणपत्र के साथ प्रवेश।',
      },
    }),
  },
});
