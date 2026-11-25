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
    title: { en: 'Academic year', hi: 'एकेडमिक ईयर (सेशन)' },
    body: {
      en: 'The session the student is joining.',
      hi: 'स्टूडेंट किस सेशन में एडमिशन ले रहा है।',
    },
    points: [
      {
        en: "The standard and section lists show only this session's standards and sections.",
        hi: 'क्लास और सेक्शन की लिस्ट में सिर्फ़ इसी सेशन की क्लास और सेक्शन दिखते हैं।',
      },
      {
        en: 'Changing it clears the standard and section you picked.',
        hi: 'सेशन बदलने पर चुनी हुई क्लास और सेक्शन हट जाते हैं।',
      },
      {
        en: 'The current session is marked Active.',
        hi: 'अभी चल रहा सेशन ऐक्टिव लिखा दिखता है।',
      },
    ],
    example: {
      en: 'Admitting in June 2025 → 2025-26. Admitting in March 2026 for the session that starts in April → 2026-27.',
      hi: 'जून 2025 में एडमिशन → 2025-26। मार्च 2026 में अप्रैल वाले सेशन के लिए एडमिशन → 2026-27।',
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
