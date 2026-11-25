import { defineFieldHelp } from '@roviq/ui';

export const resellerBrandingHelp = defineFieldHelp('resellerSettings.branding', {
  primaryColor: {
    title: { en: 'Primary colour', hi: 'मुख्य रंग' },
    body: {
      en: 'The main colour of your reseller portal.',
      hi: 'आपके रीसेलर पोर्टल का मुख्य रंग।',
    },
    points: [
      {
        en: 'Pick a colour dark enough for white text to stay readable on it.',
        hi: 'इतना गहरा रंग चुनें कि उस पर सफ़ेद अक्षर साफ़ पढ़े जाएँ।',
      },
    ],
    example: {
      en: '#0F5132 (dark green), #1F3B8A (navy)',
      hi: '#0F5132 (गहरा हरा), #1F3B8A (नेवी)',
    },
  },
  customCss: {
    title: { en: 'Custom CSS', hi: 'कस्टम CSS' },
    body: {
      en: 'Extra style rules for your portal.',
      hi: 'आपके पोर्टल के लिए अलग से स्टाइल नियम।',
    },
    points: [
      {
        en: 'Plain style rules only.',
        hi: 'सिर्फ़ सादे स्टाइल नियम।',
      },
      {
        en: '@import, url(), image(), backslashes and angle brackets are refused, so a stylesheet can never pull content from another server.',
        hi: '@import, url(), image(), बैकस्लैश और ऐंगल ब्रैकेट नहीं चलते, ताकि कोई स्टाइलशीट दूसरे सर्वर से कुछ न खींच सके।',
      },
    ],
    example: {
      en: 'Preview classes: .brand-header, .brand-sidebar, .brand-nav-item, .brand-button, .brand-card',
      hi: 'प्रीव्यू में ये क्लास चलती हैं: .brand-header, .brand-sidebar, .brand-nav-item, .brand-button, .brand-card',
    },
  },
});
