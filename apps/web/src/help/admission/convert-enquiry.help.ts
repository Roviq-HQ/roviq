import { defineFieldHelp } from '@roviq/ui';

export const convertEnquiryHelp = defineFieldHelp('admission.convert', {
  academicYear: {
    title: { en: 'Academic year', hi: 'शैक्षणिक वर्ष' },
    hint: {
      en: 'The session the student will start in.',
      hi: 'वह सत्र जिसमें विद्यार्थी पढ़ाई शुरू करेगा।',
    },
    body: {
      en: 'The session the application is for. Choose the session the student will actually start attending: for admissions done before a new session begins, that is the next session, not the current one. The standards list shows the standards of this session.',
      hi: 'वह सत्र जिसके लिए आवेदन है। वही सत्र चुनें जिसमें विद्यार्थी वास्तव में आना शुरू करेगा: नया सत्र शुरू होने से पहले हुए प्रवेश के लिए यह अगला सत्र है, वर्तमान नहीं। कक्षा सूची इसी सत्र की कक्षाएँ दिखाती है।',
    },
    example: {
      en: 'In February 2026, for a student starting in April 2026, choose 2026-27.',
      hi: 'फ़रवरी 2026 में, अप्रैल 2026 से शुरू करने वाले विद्यार्थी के लिए 2026-27 चुनें।',
    },
  },
});
