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
        en: "The institute's subscription and invoices come from this reseller's plans.",
        hi: 'संस्थान का सब्सक्रिप्शन और इनवॉइस इसी रीसेलर के प्लान से बनते हैं।',
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
        en: "The group is shown on the institute and lets you list a group's institutes together.",
        hi: 'ग्रुप संस्थान पर दिखता है और इससे एक ग्रुप के संस्थान एक साथ लिस्ट होते हैं।',
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
      en: "'DPS Group' can hold DPS-GBN-01, DPS-GBN-02, DPS-DLI-03.",
      hi: "'DPS Group' में DPS-GBN-01, DPS-GBN-02, DPS-DLI-03 आ सकते हैं।",
    },
  },
});
