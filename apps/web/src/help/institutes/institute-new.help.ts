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
      en: 'What kind of institute this is. It decides what Roviq sets up when the institute is created.',
      hi: 'यह किस तरह का संस्थान है। इससे तय होता है कि संस्थान बनते समय Roviq क्या-क्या तैयार करता है।',
    },
    points: [
      {
        en: 'It cannot be changed after the institute is created.',
        hi: 'संस्थान बनने के बाद इसे बदला नहीं जा सकता।',
      },
      {
        en: 'A wrong choice means deleting the institute and requesting it again.',
        hi: 'गलत चुनने पर संस्थान डिलीट करके नए सिरे से रिक्वेस्ट करनी पड़ती है।',
      },
    ],
    options: helpOptions<InstituteType>({
      SCHOOL: {
        en: 'Classes and sections for the chosen departments, and the subjects of the board, are set up for you.',
        hi: 'चुने गए विभागों की क्लास और सेक्शन, और बोर्ड के सब्जेक्ट अपने आप बन जाते हैं।',
      },
      COACHING: {
        en: 'Nothing is set up; you add classes yourself. Academic years may overlap, for batches that run side by side.',
        hi: 'कुछ पहले से नहीं बनता; क्लास आप खुद जोड़ते हैं। एकेडमिक ईयर एक-दूसरे पर चढ़ सकते हैं, ताकि साथ चलने वाले बैच बन सकें।',
      },
      LIBRARY: {
        en: 'One Library class with Full Day and Half Day sections is set up for members.',
        hi: 'मेंबर के लिए एक Library क्लास, Full Day और Half Day सेक्शन के साथ, बन जाती है।',
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
        en: "When a School institute is set up, this board's subjects are added for you.",
        hi: 'स्कूल वाला संस्थान बनते समय इस बोर्ड के सब्जेक्ट अपने आप जुड़ जाते हैं।',
      },
      {
        en: 'It is printed with the affiliation number on certificates, and it decides which board-specific exports the institute gets, such as the BSEH staff statement.',
        hi: 'यह सर्टिफिकेट पर अफ़िलिएशन नंबर के साथ छपता है, और इसी से तय होता है कि संस्थान को कौन से बोर्ड वाले एक्सपोर्ट मिलेंगे, जैसे BSEH स्टाफ स्टेटमेंट।',
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
