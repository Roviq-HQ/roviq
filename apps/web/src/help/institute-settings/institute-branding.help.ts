import { defineFieldHelp } from '@roviq/ui';

export const instituteBrandingHelp = defineFieldHelp('instituteSettings.branding', {
  primaryColor: {
    title: { en: 'Primary colour', hi: 'मुख्य रंग' },
    body: {
      en: 'The accent colour of buttons, links and highlights in your institute portal, for everyone in your institute, in light and dark mode. You see it here as you pick it. Choose a dark enough colour that white text on it stays easy to read.',
      hi: 'आपके संस्थान पोर्टल में बटन, लिंक और हाइलाइट का मुख्य रंग, आपके संस्थान के सभी लोगों के लिए, लाइट और डार्क दोनों मोड में। चुनते समय यह यहीं दिखता है। इतना गहरा रंग चुनें कि उस पर सफ़ेद अक्षर आसानी से पढ़े जा सकें।',
    },
    example: {
      en: '#0F5132 (dark green), #1F3B8A (navy), #7F1D1D (maroon).',
      hi: '#0F5132 (गहरा हरा), #1F3B8A (नेवी), #7F1D1D (मैरून)।',
    },
  },
  theme: {
    title: { en: 'Theme', hi: 'थीम' },
    body: {
      en: 'A look-and-feel preset for your portal. It is saved with your branding and shown to the platform team; the portal looks the same for every choice. Your logo and primary colour apply either way.',
      hi: 'आपके पोर्टल के रूप-रंग का एक प्रीसेट। यह आपकी ब्रांडिंग के साथ सहेजा जाता है और प्लेटफ़ॉर्म टीम को दिखता है; हर विकल्प में पोर्टल एक जैसा दिखता है। आपका लोगो और मुख्य रंग दोनों स्थितियों में लागू होते हैं।',
    },
  },
});
