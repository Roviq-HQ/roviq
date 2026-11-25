import { defineFieldHelp } from '@roviq/ui';

export const tcHelp = defineFieldHelp('certificates.tc', {
  requestAcademicYear: {
    title: { en: 'Academic year', hi: 'एकेडमिक ईयर' },
    body: {
      en: 'The session this transfer certificate is filed under.',
      hi: 'वह सेशन जिसके तहत यह TC दर्ज होता है।',
    },
    points: [
      {
        en: 'The TC register export of a session lists the TCs filed under it.',
        hi: 'किसी सेशन के TC रजिस्टर एक्सपोर्ट में उसी सेशन के TC आते हैं।',
      },
      {
        en: 'It does not change what the TC says.',
        hi: 'इससे TC पर लिखी बातें नहीं बदलतीं।',
      },
      {
        en: 'The class printed is the last class the student studied.',
        hi: 'TC पर वह क्लास छपती है जिसमें स्टूडेंट ने आखिरी बार पढ़ाई की।',
      },
    ],
  },
  requestReason: {
    title: { en: 'Reason for leaving', hi: 'संस्थान छोड़ने का कारण' },
    body: {
      en: 'Printed on the TC as the reason for leaving, which the next institute reads.',
      hi: 'TC पर संस्थान छोड़ने के कारण के रूप में छपता है, जिसे अगला संस्थान पढ़ता है।',
    },
    points: [
      {
        en: 'It is also shown in the TC list and the TC register export.',
        hi: 'यह TC लिस्ट और TC रजिस्टर एक्सपोर्ट में भी दिखता है।',
      },
      {
        en: 'Keep it factual and neutral.',
        hi: 'सीधी और सही बात लिखें, किसी पर टिप्पणी न करें।',
      },
    ],
    example: {
      en: 'Parents have moved to Pune for a job transfer.',
      hi: 'पेरेंट्स नौकरी के ट्रांसफ़र की वजह से पुणे चले गए हैं।',
    },
  },
  rejectReason: {
    title: { en: 'Reason for rejection', hi: 'रिजेक्ट करने का कारण' },
    body: {
      en: 'Rejecting cancels this request.',
      hi: 'रिजेक्ट करने पर यह रिक्वेस्ट रद्द हो जाती है।',
    },
    points: [
      {
        en: 'The student stays enrolled and a new request can be made.',
        hi: 'स्टूडेंट का एडमिशन बना रहता है और नई रिक्वेस्ट की जा सकती है।',
      },
      {
        en: "The reason is shown on this TC's page, so say exactly what has to be fixed first.",
        hi: 'कारण इस TC के पेज पर दिखता है, इसलिए साफ़ लिखें कि पहले क्या ठीक करना है।',
      },
    ],
    example: {
      en: 'Library book not returned (LIB-2891).',
      hi: 'लाइब्रेरी की किताब वापस नहीं की गई (LIB-2891)।',
    },
  },
  duplicateReason: {
    title: { en: 'Reason for duplicate', hi: 'डुप्लिकेट का कारण' },
    body: {
      en: 'Why a second copy is needed.',
      hi: 'दूसरी कॉपी क्यों चाहिए।',
    },
    points: [
      {
        en: 'It is kept with the duplicate request and shown on its page and in the TC register export.',
        hi: 'यह डुप्लिकेट रिक्वेस्ट के साथ रखा जाता है और उसके पेज व TC रजिस्टर एक्सपोर्ट में दिखता है।',
      },
      {
        en: "The duplicate prints the original's details with a DUPLICATE watermark.",
        hi: 'डुप्लिकेट पर असली TC की जानकारी DUPLICATE वॉटरमार्क के साथ छपती है।',
      },
      {
        en: "Its serial is the original's with -D added.",
        hi: 'उसका सीरियल असली सीरियल के आगे -D जोड़कर बनता है।',
      },
    ],
    example: {
      en: 'Original TC lost; FIR 048291 filed on 14 March 2025.',
      hi: 'असली TC खो गया; 14 मार्च 2025 को FIR 048291 दर्ज की गई।',
    },
  },
});
