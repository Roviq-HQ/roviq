import type { GuardianEducationLevel } from '@roviq/common-types';
import { defineFieldHelp, helpOptions } from '@roviq/ui';

export const guardianNewHelp = defineFieldHelp('guardians.new', {
  educationLevel: {
    title: { en: 'Education level', hi: 'शिक्षा स्तर' },
    body: {
      en: "The highest level of education the guardian has completed. Only the level is kept, not the degree or university. It is shown on the guardian's profile and in the guardian list; no export or message uses it.",
      hi: 'अभिभावक द्वारा पूरी की गई उच्चतम शिक्षा का स्तर। केवल स्तर रखा जाता है, डिग्री या विश्वविद्यालय नहीं। यह अभिभावक की प्रोफ़ाइल और अभिभावक सूची में दिखता है; कोई एक्सपोर्ट या संदेश इसका उपयोग नहीं करता।',
    },
    options: helpOptions<GuardianEducationLevel>({
      ILLITERATE: { en: 'Never studied at any institute.', hi: 'कभी किसी शिक्षण संस्थान में नहीं पढ़े।' },
      PRIMARY: { en: 'Studied up to Class 5.', hi: 'कक्षा 5 तक पढ़े।' },
      SECONDARY: { en: 'Passed Class 10 or 12.', hi: 'कक्षा 10 या 12 उत्तीर्ण।' },
      GRADUATE: { en: "A bachelor's degree.", hi: 'स्नातक डिग्री।' },
      POST_GRADUATE: { en: "A master's degree or higher.", hi: 'स्नातकोत्तर डिग्री या उससे ऊपर।' },
      PROFESSIONAL: { en: 'MBBS, LLB, CA, CS or similar.', hi: 'MBBS, LLB, CA, CS या समान।' },
    }),
  },
});
