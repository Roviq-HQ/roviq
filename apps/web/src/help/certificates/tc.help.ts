import { defineFieldHelp } from '@roviq/ui';

export const tcHelp = defineFieldHelp('certificates.tc', {
  requestAcademicYear: {
    title: { en: 'Academic year', hi: 'शैक्षणिक वर्ष' },
    body: {
      en: 'The session this transfer certificate is filed under: the TC register export of a session lists the TCs filed under it. It does not change what the TC says; the class printed is the last class the student studied.',
      hi: 'वह सत्र जिसके अंतर्गत यह स्थानांतरण प्रमाणपत्र दर्ज होता है: किसी सत्र का TC रजिस्टर एक्सपोर्ट उसके अंतर्गत दर्ज TC दिखाता है। इससे TC की बातें नहीं बदलतीं; छपने वाली कक्षा वह है जिसमें विद्यार्थी ने अंतिम बार पढ़ाई की।',
    },
  },
  requestReason: {
    title: { en: 'Reason for leaving', hi: 'छोड़ने का कारण' },
    body: {
      en: 'Printed on the TC as the reason for leaving, which the next institute reads. It is also shown in the TC list and the TC register export. Keep it factual and neutral.',
      hi: 'TC पर छोड़ने के कारण के रूप में छपता है, जिसे अगला संस्थान पढ़ता है। यह TC सूची और TC रजिस्टर एक्सपोर्ट में भी दिखता है। इसे तथ्यात्मक और तटस्थ रखें।',
    },
    example: {
      en: 'Parents have moved to Pune for a job transfer.',
      hi: 'अभिभावक नौकरी के स्थानांतरण के कारण पुणे चले गए हैं।',
    },
  },
  rejectReason: {
    title: { en: 'Reason for rejection', hi: 'अस्वीकृति का कारण' },
    body: {
      en: "Rejecting cancels this request; the student stays enrolled and a new request can be made. The reason is shown on this TC's page, so say exactly what has to be fixed first.",
      hi: 'अस्वीकार करने पर यह अनुरोध रद्द हो जाता है; विद्यार्थी नामांकित रहता है और नया अनुरोध किया जा सकता है। कारण इस TC के पेज पर दिखता है, इसलिए साफ़ लिखें कि पहले क्या ठीक करना है।',
    },
    example: {
      en: 'Library book not returned (LIB-2891).',
      hi: 'पुस्तकालय की पुस्तक वापस नहीं की गई (LIB-2891)।',
    },
  },
  duplicateReason: {
    title: { en: 'Reason for duplicate', hi: 'डुप्लिकेट का कारण' },
    body: {
      en: "Why a second copy is needed. It is kept with the duplicate request and shown on its page and in the TC register export. The duplicate prints the original's details with a DUPLICATE watermark, and its serial is the original's with -D added.",
      hi: 'दूसरी प्रति क्यों चाहिए। यह डुप्लिकेट अनुरोध के साथ रखा जाता है और उसके पेज व TC रजिस्टर एक्सपोर्ट में दिखता है। डुप्लिकेट पर मूल TC का विवरण DUPLICATE वॉटरमार्क के साथ छपता है, और उसका सीरियल मूल सीरियल के साथ -D जोड़कर बनता है।',
    },
    example: {
      en: 'Original TC lost; FIR 048291 filed on 14 March 2025.',
      hi: 'मूल TC खो गया; 14 मार्च 2025 को FIR 048291 दर्ज की गई।',
    },
  },
});
