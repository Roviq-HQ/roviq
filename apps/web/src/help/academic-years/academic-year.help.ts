import { defineFieldHelp } from '@roviq/ui';

export const academicYearHelp = defineFieldHelp('academicYears.form', {
  label: {
    title: { en: 'Academic year label', hi: 'एकेडमिक ईयर का लेबल' },
    hint: {
      en: 'Printed in government exports and their file names.',
      hi: 'सरकारी एक्सपोर्ट और उनकी फ़ाइल के नाम में छपता है।',
    },
    body: {
      en: 'The short name of the session. It is printed in government exports and their file names.',
      hi: 'सेशन का छोटा नाम। यह सरकारी एक्सपोर्ट और उनकी फ़ाइल के नाम में छपता है।',
    },
    points: [
      {
        en: 'It is shown wherever a year is chosen.',
        hi: 'जहाँ भी साल चुना जाता है, वहाँ यही दिखता है।',
      },
      {
        en: 'The first part is the year the session starts.',
        hi: 'पहला हिस्सा सेशन शुरू होने का साल है।',
      },
      {
        en: 'The second part is the last two digits of the year it ends.',
        hi: 'दूसरा हिस्सा खत्म होने वाले साल के आखिरी दो अंक हैं।',
      },
    ],
    example: {
      en: '1 April 2025 to 31 March 2026 is 2025-26.',
      hi: '1 अप्रैल 2025 से 31 मार्च 2026 का सेशन 2025-26 है।',
    },
  },
  startDate: {
    title: { en: 'Start date', hi: 'शुरू होने की तारीख' },
    hint: { en: 'First working day of the session.', hi: 'सेशन का पहला कामकाजी दिन।' },
    body: {
      en: 'The first working day of the session.',
      hi: 'सेशन का पहला कामकाजी दिन।',
    },
    points: [
      {
        en: 'Except in coaching institutes, it cannot fall inside another academic year.',
        hi: 'कोचिंग संस्थानों को छोड़कर, यह किसी दूसरे एकेडमिक ईयर के बीच में नहीं आ सकती।',
      },
    ],
    article: () => import('./academic-year.articles').then((m) => m.sessionDates),
  },
  endDate: {
    title: { en: 'End date', hi: 'खत्म होने की तारीख' },
    hint: { en: 'Last working day of the session.', hi: 'सेशन का आखिरी कामकाजी दिन।' },
    body: {
      en: 'The last working day of the session.',
      hi: 'सेशन का आखिरी कामकाजी दिन।',
    },
    points: [
      {
        en: 'It must come after the start date.',
        hi: 'यह शुरू होने की तारीख के बाद की होनी चाहिए।',
      },
      {
        en: 'Except in coaching institutes, it cannot fall inside another academic year.',
        hi: 'कोचिंग संस्थानों को छोड़कर, यह किसी दूसरे एकेडमिक ईयर के बीच में नहीं आ सकती।',
      },
    ],
    article: () => import('./academic-year.articles').then((m) => m.sessionDates),
  },
  termStructure: {
    title: { en: 'Term structure', hi: 'टर्म का ढाँचा' },
    hint: {
      en: 'Optional: divide the session into terms.',
      hi: 'ज़रूरी नहीं: सेशन को टर्म में बाँटें।',
    },
    body: {
      en: 'The terms the session is divided into, each with a name and its own dates.',
      hi: 'वे टर्म जिनमें सेशन बँटा है, हर एक का नाम और अपनी तारीखें।',
    },
    points: [
      {
        en: 'They are saved with the academic year.',
        hi: 'ये एकेडमिक ईयर के साथ सेव होते हैं।',
      },
      {
        en: 'Skip this if the institute runs one annual exam.',
        hi: 'अगर संस्थान में सिर्फ़ एक सालाना परीक्षा होती है तो इसे छोड़ दें।',
      },
    ],
    example: {
      en: '2 terms (semesters), 3 terms (trimesters) or 4 quarters.',
      hi: '2 टर्म (सेमेस्टर), 3 टर्म (ट्राईमेस्टर) या 4 तिमाही।',
    },
  },
});
