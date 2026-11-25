import type { GroupType } from '@roviq/common-types';
import { defineFieldHelp, helpOptions } from '@roviq/ui';

export const instituteGroupNewHelp = defineFieldHelp('adminInstituteGroups.new', {
  code: {
    title: { en: 'Group code', hi: 'ग्रुप का कोड' },
    body: {
      en: 'A unique short code that identifies this group across Roviq. It is used in URLs and APIs.',
      hi: 'ग्रुप की पहचान का यूनिक छोटा कोड, पूरे Roviq में। यह URL और API में इस्तेमाल होता है।',
    },
    points: [
      {
        en: 'Lowercase letters, numbers and hyphens only.',
        hi: 'सिर्फ़ छोटे अक्षर, अंक और हाइफ़न।',
      },
      {
        en: 'It cannot be changed after creation, so choose a stable value.',
        hi: 'बनने के बाद इसे बदला नहीं जा सकता, इसलिए ऐसा कोड चुनें जो न बदले।',
      },
    ],
    example: { en: 'dps-society · ryan-trust', hi: 'dps-society · ryan-trust' },
  },
  type: {
    title: { en: 'Group type', hi: 'ग्रुप का टाइप' },
    body: {
      en: 'The legal structure this group operates under.',
      hi: 'ग्रुप किस कानूनी ढाँचे में चलता है।',
    },
    points: [
      {
        en: 'It decides which registration fields are expected and how invoices are taxed (trusts and societies are often exempt; chains and franchises are not).',
        hi: 'इससे तय होता है कि कौन सी रजिस्ट्रेशन जानकारी चाहिए और इनवॉइस पर टैक्स कैसे लगेगा (ट्रस्ट और सोसाइटी अक्सर छूट में होते हैं; चेन और फ़्रैंचाइज़ी नहीं)।',
      },
      {
        en: 'It also decides whether the group can claim CSR and Section 80G benefits.',
        hi: 'इसी से तय होता है कि ग्रुप CSR और सेक्शन 80G के फ़ायदे ले सकता है या नहीं।',
      },
      {
        en: 'If the group is registered as one type but works like another, go by the registration.',
        hi: 'अगर ग्रुप रजिस्टर एक टाइप में है पर चलता दूसरे की तरह है, तो रजिस्ट्रेशन वाला टाइप चुनें।',
      },
    ],
    options: helpOptions<GroupType>({
      TRUST: {
        en: 'Registered under the Indian Trusts Act 1882 or a state Public Trust Act. Common for institutes started by families or religious bodies.',
        hi: 'Indian Trusts Act 1882 या स्टेट के पब्लिक ट्रस्ट ऐक्ट में रजिस्टर। परिवारों या धार्मिक संस्थाओं के शुरू किए संस्थानों में आम।',
      },
      SOCIETY: {
        en: 'Registered under the Societies Registration Act 1860 (or the state one). The most common form for institute managements.',
        hi: 'Societies Registration Act 1860 (या स्टेट के ऐक्ट) में रजिस्टर। संस्थान मैनेजमेंट में सबसे आम।',
      },
      CHAIN: {
        en: 'Many institutes under one management and brand, not necessarily a trust or society.',
        hi: 'एक मैनेजमेंट और ब्रांड के कई संस्थान, ट्रस्ट या सोसाइटी होना ज़रूरी नहीं।',
      },
      FRANCHISE: {
        en: 'A brand owner licenses brand, curriculum and standards to independent operators. Each franchisee is billed separately.',
        hi: 'ब्रांड का मालिक अलग-अलग ऑपरेटर को ब्रांड, करिकुलम और स्टैंडर्ड का लाइसेंस देता है। हर फ़्रैंचाइज़ी का बिल अलग बनता है।',
      },
    }),
  },
  registrationNumber: {
    title: { en: 'Registration number', hi: 'रजिस्ट्रेशन नंबर' },
    body: {
      en: 'The unique number issued by the Registrar of Societies, Charity Commissioner or Trust registrar.',
      hi: 'रजिस्ट्रार ऑफ़ सोसाइटीज़, चैरिटी कमिश्नर या ट्रस्ट रजिस्ट्रार का दिया यूनिक नंबर।',
    },
    points: [
      {
        en: 'Needed if invoices should show the legal entity, or to claim tax exemptions or issue 80G donation receipts.',
        hi: 'यह तब चाहिए जब इनवॉइस पर कानूनी संस्था का नाम दिखाना हो, टैक्स छूट लेनी हो या 80G डोनेशन रिसीट देनी हो।',
      },
      {
        en: 'Optional for Chain and Franchise groups registered as companies.',
        hi: 'कंपनी की तरह रजिस्टर चेन और फ़्रैंचाइज़ी ग्रुप के लिए ज़रूरी नहीं।',
      },
    ],
  },
  registrationState: {
    title: { en: 'Registration state', hi: 'रजिस्ट्रेशन का राज्य' },
    body: {
      en: 'The state where this trust or society is legally registered.',
      hi: 'वह राज्य जहाँ यह ट्रस्ट या सोसाइटी कानूनी तौर पर रजिस्टर है।',
    },
    points: [
      {
        en: 'It must match the state printed on your registration certificate.',
        hi: 'यह आपके रजिस्ट्रेशन सर्टिफिकेट पर छपे राज्य से मिलना चाहिए।',
      },
    ],
    avoid: {
      en: 'A different state from the certificate. It can delay 80G approvals and GST exemption reviews.',
      hi: 'सर्टिफिकेट से अलग राज्य। इससे 80G अप्रूवल और GST छूट की जाँच में देर हो सकती है।',
    },
  },
});
