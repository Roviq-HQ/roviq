import { defineFieldHelp } from '@roviq/ui';

export const resellerInstituteNewHelp = defineFieldHelp('resellerInstitutes.new', {
  group: {
    title: { en: 'Institute group', hi: 'संस्थान ग्रुप' },
    body: {
      en: 'Links this institute to a parent trust, society or chain registered under your reseller account.',
      hi: 'इस संस्थान को आपके रीसेलर अकाउंट में दर्ज किसी ट्रस्ट, सोसाइटी या चेन से जोड़ता है।',
    },
    points: [
      {
        en: "The group is shown on the institute and lets you list a group's institutes together. Each institute keeps its own data and settings.",
        hi: 'ग्रुप संस्थान पर दिखता है और इससे एक ग्रुप के संस्थान एक साथ लिस्ट होते हैं। हर संस्थान का डेटा और सेटिंग अलग रहती है।',
      },
      {
        en: 'Leave blank if this is a standalone client.',
        hi: 'अकेले क्लाइंट के लिए खाली छोड़ें।',
      },
    ],
  },
});
