import { defineFieldHelp } from '@roviq/ui';

export const subscriptionActionsHelp = defineFieldHelp('resellerBilling.subscriptionActions', {
  reason: {
    title: { en: 'Reason', hi: 'कारण' },
    body: {
      en: 'Why this change is made. It is saved on the subscription as the pause or cancel reason.',
      hi: 'यह बदलाव क्यों हो रहा है। यह सब्सक्रिप्शन पर रोकने या कैंसल करने के कारण की तरह सेव होता है।',
    },
    points: [
      {
        en: 'Use the same wording for the same reason every time, so reasons can be compared later.',
        hi: 'एक ही कारण के लिए हर बार एक जैसे शब्द लिखें, ताकि बाद में कारणों की तुलना हो सके।',
      },
    ],
    example: {
      en: 'Price too high · Institute closed · Moved to another software',
      hi: 'कीमत ज़्यादा · संस्थान बंद · दूसरे सॉफ़्टवेयर पर चले गए',
    },
  },
  proration: {
    title: { en: 'How proration is calculated', hi: 'प्रो-रेशन कैसे निकलता है' },
    body: {
      en: 'The difference between the unused days on the old plan and the days left in the cycle on the new plan.',
      hi: 'पुराने प्लान के बचे दिनों और नए प्लान के साइकिल में बचे दिनों के बीच का फ़र्क।',
    },
    points: [
      {
        en: "Credit for the old plan: remaining unused days at the old plan's daily rate.",
        hi: 'पुराने प्लान का क्रेडिट: बचे दिन, पुराने प्लान के रोज़ के रेट से।',
      },
      {
        en: "Charge for the new plan: remaining days in the cycle at the new plan's daily rate.",
        hi: 'नए प्लान का चार्ज: साइकिल के बचे दिन, नए प्लान के रोज़ के रेट से।',
      },
      {
        en: 'The difference is saved with the plan change. Roviq does not add it to an invoice by itself.',
        hi: 'यह फ़र्क प्लान बदलने के साथ सेव होता है। Roviq इसे अपने आप किसी इनवॉइस में नहीं जोड़ता।',
      },
    ],
  },
});
