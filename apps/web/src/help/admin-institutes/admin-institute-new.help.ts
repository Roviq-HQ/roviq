import { defineFieldHelp } from '@roviq/ui';

export const adminInstituteNewHelp = defineFieldHelp('adminInstitutes.new', {
  reseller: {
    title: { en: 'Reseller partner', hi: 'रीसेलर पार्टनर' },
    body: {
      en: 'The reseller partner responsible for onboarding, support and invoicing this institute.',
      hi: 'वह रीसेलर पार्टनर जो इस संस्थान का ऑनबोर्डिंग, सपोर्ट और इनवॉइस देखता है।',
    },
    points: [
      {
        en: 'Invoices are issued by the reseller, and their support team receives tickets first.',
        hi: 'इनवॉइस रीसेलर जारी करता है और टिकट पहले उसकी सपोर्ट टीम को मिलते हैं।',
      },
      {
        en: 'Their commission applies to every paid subscription.',
        hi: 'हर पेड सब्सक्रिप्शन पर उनका कमीशन लगता है।',
      },
      {
        en: 'Changing the reseller later is a contractual change and should route through finance.',
        hi: 'रीसेलर बाद में बदलना कॉन्ट्रैक्ट का बदलाव है, इसे फ़ाइनेंस से करवाएँ।',
      },
      {
        en: 'Leave blank for institutes sold and supported directly by Roviq.',
        hi: 'जो संस्थान सीधे Roviq बेचता और सँभालता है, उसके लिए खाली छोड़ें।',
      },
    ],
    example: {
      en: 'A district EdTech consultant who resells Roviq to 30 local institutes.',
      hi: 'ज़िले का एक EdTech कंसल्टेंट जो 30 लोकल संस्थानों को Roviq बेचता है।',
    },
  },
  group: {
    title: { en: 'Institute group', hi: 'संस्थान ग्रुप' },
    body: {
      en: 'Links this institute to the other branches of the same chain, such as DPS Society or Amity Group.',
      hi: 'इस संस्थान को उसी चेन की दूसरी ब्रांच से जोड़ता है, जैसे DPS Society या Amity Group।',
    },
    points: [
      {
        en: 'Grouped institutes can share branding, plan tiers and cross-institute analytics.',
        hi: 'ग्रुप के संस्थान ब्रांडिंग, प्लान टियर और क्रॉस-संस्थान एनालिटिक्स शेयर कर सकते हैं।',
      },
      {
        en: 'Each branch still keeps its own data.',
        hi: 'हर ब्रांच का अपना डेटा अलग ही रहता है।',
      },
      {
        en: 'Leave blank for a standalone institute.',
        hi: 'अकेले संस्थान के लिए खाली छोड़ें।',
      },
    ],
    example: {
      en: "'DPS Group' can hold DPS-GBN-01, DPS-GBN-02, DPS-DLI-03. A parent with children in two branches can switch between them from one login.",
      hi: "'DPS Group' में DPS-GBN-01, DPS-GBN-02, DPS-DLI-03 आ सकते हैं। दो ब्रांच में बच्चे वाला पेरेंट एक ही लॉग इन से दोनों में जा सकता है।",
    },
  },
});
