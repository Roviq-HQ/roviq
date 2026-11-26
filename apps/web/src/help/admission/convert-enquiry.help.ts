import { defineFieldHelp } from '@roviq/ui';

export const convertEnquiryHelp = defineFieldHelp('admission.convert', {
  academicYear: {
    title: { en: 'Academic year', hi: 'एकेडमिक ईयर' },
    hint: {
      en: 'The session the student will start in.',
      hi: 'वह सेशन जिसमें स्टूडेंट पढ़ाई शुरू करेगा।',
    },
    body: {
      en: 'The session the application is for.',
      hi: 'वह सेशन जिसके लिए ऐप्लिकेशन है।',
    },
    points: [
      {
        en: 'Choose the session the student will actually start attending.',
        hi: 'वही सेशन चुनें जिसमें स्टूडेंट सच में आना शुरू करेगा।',
      },
      {
        en: 'For an admission done before a new session begins, that is the next session, not the current one.',
        hi: 'नया सेशन शुरू होने से पहले हुए एडमिशन के लिए यह अगला सेशन है, मौजूदा नहीं।',
      },
      {
        en: 'The standards list shows the standards of this session.',
        hi: 'क्लास की लिस्ट में इसी सेशन की क्लास दिखती हैं।',
      },
    ],
    example: {
      en: 'In February 2026, for a student starting in April 2026, choose 2026-27.',
      hi: 'फ़रवरी 2026 में, अप्रैल 2026 से शुरू करने वाले स्टूडेंट के लिए 2026-27 चुनें।',
    },
  },
});
