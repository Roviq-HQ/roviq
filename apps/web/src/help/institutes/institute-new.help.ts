import type { InstituteType, StructureFramework } from '@roviq/common-types';
import { defineFieldHelp, helpOptions } from '@roviq/ui';

/** Shared by the admin and reseller "new institute" forms, which describe the same behaviour. */
export const instituteNewHelp = defineFieldHelp('institutes.new', {
  code: {
    title: { en: 'Institute code', hi: 'संस्थान का कोड' },
    body: {
      en: 'A short code for the institute, in capital letters. It shows in URLs, receipts and exports.',
      hi: 'संस्थान का छोटा कोड, कैपिटल लेटर्स में। यह URL, रिसीट और एक्सपोर्ट में दिखता है।',
    },
    points: [
      {
        en: 'Must be unique across all of Roviq.',
        hi: 'पूरे Roviq पर यूनिक होना चाहिए, कोई दूसरा संस्थान यह कोड नहीं ले सकता।',
      },
      {
        en: "Can't be changed after the institute is approved.",
        hi: 'संस्थान अप्रूव होने के बाद कोड बदला नहीं जा सकता।',
      },
      {
        en: 'Before submitting, ask your client whether they already use a code.',
        hi: 'सबमिट करने से पहले क्लाइंट से पूछ लें कि उनका कोई कोड पहले से चल रहा है या नहीं।',
      },
    ],
    example: {
      en: 'DPS-GBN-01 · RAYAT-JPR · DAV-LKO-12',
      hi: 'DPS-GBN-01 · RAYAT-JPR · DAV-LKO-12',
    },
    avoid: {
      en: 'Common codes like INST-01. Other resellers ask for the same ones, so the request may be rejected.',
      hi: 'INST-01 जैसे आम कोड। दूसरे रीसेलर भी यही माँगते हैं, इसलिए रिक्वेस्ट रिजेक्ट हो सकती है।',
    },
  },
  type: {
    title: { en: 'Institute type', hi: 'संस्थान का टाइप' },
    body: {
      en: 'What kind of institute this is. It decides the features, academic structure and fee models the institute gets.',
      hi: 'यह किस तरह का संस्थान है। इससे तय होता है कि संस्थान को कौन से फ़ीचर, पढ़ाई का ढाँचा और फ़ीस मॉडल मिलेंगे।',
    },
    points: [
      {
        en: 'It cannot be changed after creation, because the other type would break the data (classes, timetables, report cards).',
        hi: 'बनने के बाद इसे बदला नहीं जा सकता, क्योंकि दूसरा टाइप डेटा (क्लास, टाइमटेबल, रिपोर्ट कार्ड) बिगाड़ देगा।',
      },
      {
        en: 'A wrong choice means deleting the institute and requesting it again.',
        hi: 'गलत चुनने पर संस्थान डिलीट करके नए सिरे से रिक्वेस्ट करनी पड़ती है।',
      },
    ],
    options: helpOptions<InstituteType>({
      SCHOOL: {
        en: 'K-12 with classes, sections, timetables, report cards and boards. Has UDISE+, RTE and TC.',
        hi: 'K-12: क्लास, सेक्शन, टाइमटेबल, रिपोर्ट कार्ड और बोर्ड। UDISE+, RTE और TC मिलते हैं।',
      },
      COACHING: {
        en: 'Test-prep centre with batches, courses and fee structures. No UDISE+ or TC.',
        hi: 'बैच, कोर्स और फ़ीस वाला कोचिंग सेंटर। UDISE+ और TC नहीं मिलते।',
      },
      LIBRARY: {
        en: 'Lending or reading room with members, inventory and due dates. No class or exam features.',
        hi: 'मेंबर, इन्वेंटरी और वापसी की तारीख वाली लाइब्रेरी। क्लास या परीक्षा के फ़ीचर नहीं मिलते।',
      },
    }),
  },
  structureFramework: {
    title: { en: 'Structure framework', hi: 'पढ़ाई का ढाँचा' },
    body: {
      en: 'How the standards are grouped into stages. It applies to School institutes only.',
      hi: 'क्लास किन स्टेज में बँटी हैं। यह सिर्फ़ स्कूल टाइप के संस्थान पर लागू होता है।',
    },
    options: helpOptions<StructureFramework>({
      NEP: {
        en: 'National Education Policy 2020: Foundational, Preparatory, Middle, Secondary.',
        hi: 'नेशनल एजुकेशन पॉलिसी 2020: फ़ाउंडेशनल, प्रिपरेटरी, मिडिल, सेकेंडरी।',
      },
      TRADITIONAL: {
        en: '10+2, used by CBSE, ICSE and most state boards.',
        hi: '10+2, जो CBSE, ICSE और ज़्यादातर स्टेट बोर्ड में चलता है।',
      },
    }),
    points: [
      {
        en: 'Pick NEP only if the institute follows the 2020 policy.',
        hi: 'NEP तभी चुनें जब संस्थान 2020 की पॉलिसी पर चलता हो।',
      },
    ],
  },
  board: {
    title: { en: 'Board', hi: 'बोर्ड' },
    body: {
      en: "The institute's main board of affiliation.",
      hi: 'संस्थान का मुख्य बोर्ड, जिससे वह जुड़ा है।',
    },
    points: [
      {
        en: 'It filters the state list on the address.',
        hi: 'इससे पते में राज्यों की लिस्ट छँटती है।',
      },
      {
        en: 'It decides the grading system, the report card format and whether UDISE+, APAAR and TC templates apply.',
        hi: 'इससे ग्रेडिंग सिस्टम, रिपोर्ट कार्ड का फ़ॉर्मैट और UDISE+, APAAR व TC टेम्पलेट लगेंगे या नहीं, यह तय होता है।',
      },
      {
        en: 'More boards can be added later under Board Affiliations.',
        hi: 'और बोर्ड बाद में बोर्ड अफ़िलिएशन में जोड़े जा सकते हैं।',
      },
      {
        en: 'If your board is missing, pick the closest one and contact support.',
        hi: 'आपका बोर्ड लिस्ट में न हो तो सबसे मिलता-जुलता चुनें और सपोर्ट से बात करें।',
      },
    ],
  },
  firstAdmin: {
    title: { en: 'Who receives the login details', hi: 'लॉग इन की जानकारी किसे मिलेगी' },
    body: {
      en: 'When setup runs, this person becomes the institute admin.',
      hi: 'सेटअप चलने पर यह व्यक्ति संस्थान का एडमिन बन जाता है।',
    },
    points: [
      {
        en: 'If no Roviq account uses this email, a new account is created.',
        hi: 'इस ईमेल से कोई Roviq अकाउंट नहीं है तो नया अकाउंट बन जाता है।',
      },
      {
        en: 'An account that has never signed in, including a new one, gets a new temporary password by email and mobile number.',
        hi: 'जिस अकाउंट से कभी लॉग इन नहीं हुआ, नए अकाउंट समेत, उसे ईमेल और मोबाइल नंबर पर नया अस्थायी पासवर्ड मिलता है।',
      },
      {
        en: 'An account that has already signed in keeps its password and just gets access to this institute.',
        hi: 'जो अकाउंट पहले लॉग इन कर चुका है, उसका पासवर्ड वही रहता है और उसे बस इस संस्थान का एक्सेस मिल जाता है।',
      },
    ],
  },
});
