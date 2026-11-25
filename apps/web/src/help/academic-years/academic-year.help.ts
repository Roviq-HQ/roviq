import { defineFieldHelp } from '@roviq/ui';

export const academicYearHelp = defineFieldHelp('academicYears.form', {
  label: {
    title: { en: 'Academic year label', hi: 'शैक्षणिक वर्ष का लेबल' },
    hint: {
      en: 'Printed in government exports and their file names.',
      hi: 'सरकारी एक्सपोर्ट और उनकी फ़ाइल के नाम में छपता है।',
    },
    body: {
      en: 'The short name of the session, shown wherever a year is chosen and printed in government exports and their file names. The first part is the year the session starts; the second is the last two digits of the year it ends.',
      hi: 'सत्र का छोटा नाम, जो वर्ष चुनने की हर जगह दिखता है और सरकारी एक्सपोर्ट व उनकी फ़ाइल के नाम में छपता है। पहला भाग सत्र शुरू होने का वर्ष है; दूसरा भाग समाप्ति वर्ष के अंतिम दो अंक।',
    },
    example: {
      en: '1 April 2025 to 31 March 2026 is 2025-26.',
      hi: '1 अप्रैल 2025 से 31 मार्च 2026 का सत्र 2025-26 है।',
    },
  },
  startDate: {
    title: { en: 'Start date', hi: 'प्रारंभ तिथि' },
    hint: { en: 'First working day of the session.', hi: 'सत्र का पहला कार्य दिवस।' },
    body: {
      en: 'The first working day of the session. Except in coaching institutes, it cannot fall inside another academic year.',
      hi: 'सत्र का पहला कार्य दिवस। कोचिंग संस्थानों को छोड़कर, यह किसी दूसरे शैक्षणिक वर्ष के भीतर नहीं हो सकता।',
    },
    article: () => import('./academic-year.articles').then((m) => m.sessionDates),
  },
  endDate: {
    title: { en: 'End date', hi: 'समाप्ति तिथि' },
    hint: { en: 'Last working day of the session.', hi: 'सत्र का अंतिम कार्य दिवस।' },
    body: {
      en: 'The last working day of the session. It must come after the start date and, except in coaching institutes, cannot fall inside another academic year.',
      hi: 'सत्र का अंतिम कार्य दिवस। यह प्रारंभ तिथि के बाद होनी चाहिए और, कोचिंग संस्थानों को छोड़कर, किसी दूसरे शैक्षणिक वर्ष के भीतर नहीं हो सकती।',
    },
    article: () => import('./academic-year.articles').then((m) => m.sessionDates),
  },
  termStructure: {
    title: { en: 'Term structure', hi: 'सत्रांश संरचना' },
    hint: {
      en: 'Optional: divide the session into terms.',
      hi: 'वैकल्पिक: सत्र को सत्रांशों में बाँटें।',
    },
    body: {
      en: 'The terms the session is divided into, each with a name and its own dates. They are saved with the academic year. Skip this if the institute runs one annual exam.',
      hi: 'वे सत्रांश जिनमें सत्र बँटा है, हर एक का नाम और अपनी तिथियाँ। ये शैक्षणिक वर्ष के साथ सहेजे जाते हैं। यदि संस्थान एक वार्षिक परीक्षा कराता है तो इसे छोड़ दें।',
    },
    example: {
      en: '2 terms (semesters), 3 terms (trimesters) or 4 quarters.',
      hi: '2 सत्रांश (सेमेस्टर), 3 सत्रांश (त्रैमासिक) या 4 तिमाही।',
    },
  },
});
