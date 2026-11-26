import { defineFieldHelp } from '@roviq/ui';

export const instituteBrandingHelp = defineFieldHelp('instituteSettings.branding', {
  primaryColor: {
    title: { en: 'Primary colour', hi: 'मुख्य रंग' },
    body: {
      en: 'The accent colour of buttons, links and highlights in your institute portal.',
      hi: 'आपके संस्थान पोर्टल में बटन, लिंक और हाइलाइट का रंग।',
    },
    points: [
      {
        en: 'It applies to everyone in your institute, in light and dark mode.',
        hi: 'यह आपके संस्थान के सभी लोगों के लिए लगता है, लाइट और डार्क दोनों मोड में।',
      },
      {
        en: 'You see it here as you pick it.',
        hi: 'चुनते समय यह यहीं दिख जाता है।',
      },
      {
        en: 'Choose a dark enough colour that white text on it stays easy to read.',
        hi: 'इतना गहरा रंग चुनें कि उस पर सफ़ेद अक्षर आसानी से पढ़े जाएँ।',
      },
    ],
    example: {
      en: '#0F5132 (dark green), #1F3B8A (navy), #7F1D1D (maroon).',
      hi: '#0F5132 (गहरा हरा), #1F3B8A (नेवी), #7F1D1D (मैरून)।',
    },
  },
  theme: {
    title: { en: 'Theme', hi: 'थीम' },
    body: {
      en: 'A look-and-feel preset for your portal.',
      hi: 'आपके पोर्टल के लुक का एक प्रीसेट।',
    },
    points: [
      {
        en: 'It is saved with your branding and shown to the platform team.',
        hi: 'यह आपकी ब्रांडिंग के साथ सेव होता है और प्लेटफ़ॉर्म टीम को दिखता है।',
      },
      {
        en: 'The portal looks the same for every choice.',
        hi: 'हर चुनाव में पोर्टल एक जैसा दिखता है।',
      },
      {
        en: 'Your logo and primary colour apply either way.',
        hi: 'आपका लोगो और मुख्य रंग दोनों हाल में लगते हैं।',
      },
    ],
  },
});
