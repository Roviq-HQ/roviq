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
        en: 'Grouped institutes share branding defaults and roll up into consolidated reporting.',
        hi: 'ग्रुप के संस्थान ब्रांडिंग के डिफ़ॉल्ट शेयर करते हैं और मिली-जुली रिपोर्टिंग में जुड़ते हैं।',
      },
      {
        en: 'Leave blank if this is a standalone client.',
        hi: 'अकेले क्लाइंट के लिए खाली छोड़ें।',
      },
    ],
  },
});
