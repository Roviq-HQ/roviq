import type { GuardianEducationLevel } from '@roviq/common-types';
import { defineFieldHelp, helpOptions } from '@roviq/ui';

export const guardianNewHelp = defineFieldHelp('guardians.new', {
  educationLevel: {
    title: { en: 'Education level', hi: 'पढ़ाई का स्तर' },
    body: {
      en: 'The highest level of education the guardian has completed.',
      hi: 'अभिभावक ने पढ़ाई का सबसे ऊँचा जो स्तर पूरा किया है।',
    },
    points: [
      {
        en: 'Only the level is kept, not the degree or university.',
        hi: 'सिर्फ़ स्तर रखा जाता है, डिग्री या यूनिवर्सिटी नहीं।',
      },
      {
        en: "It is shown on the guardian's profile and in the guardian list.",
        hi: 'यह अभिभावक की प्रोफ़ाइल और अभिभावक लिस्ट में दिखता है।',
      },
      {
        en: 'No export or message uses it.',
        hi: 'कोई एक्सपोर्ट या मैसेज इसका इस्तेमाल नहीं करता।',
      },
    ],
    options: helpOptions<GuardianEducationLevel>({
      ILLITERATE: { en: 'Never studied at any institute.', hi: 'कभी किसी संस्थान में नहीं पढ़े।' },
      PRIMARY: { en: 'Studied up to Class 5.', hi: 'क्लास 5 तक पढ़े।' },
      SECONDARY: { en: 'Passed Class 10 or 12.', hi: 'क्लास 10 या 12 पास।' },
      GRADUATE: { en: "A bachelor's degree.", hi: 'ग्रेजुएट (बैचलर डिग्री)।' },
      POST_GRADUATE: {
        en: "A master's degree or higher.",
        hi: 'पोस्ट ग्रेजुएट (मास्टर डिग्री) या उससे ऊपर।',
      },
      PROFESSIONAL: { en: 'MBBS, LLB, CA, CS or similar.', hi: 'MBBS, LLB, CA, CS या ऐसी ही।' },
    }),
  },
});
