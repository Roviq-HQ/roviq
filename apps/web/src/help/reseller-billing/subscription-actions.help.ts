import { defineFieldHelp } from '@roviq/ui';

export const subscriptionActionsHelp = defineFieldHelp('resellerBilling.subscriptionActions', {
  reason: {
    title: { en: 'Reason', hi: 'कारण' },
    body: {
      en: 'Why this change is made. It goes into the subscription event log and the churn-reasons chart on the finance dashboard.',
      hi: 'यह बदलाव क्यों हो रहा है। यह सब्सक्रिप्शन इवेंट लॉग और फ़ाइनेंस डैशबोर्ड के चर्न-रीज़न चार्ट में जाता है।',
    },
    points: [
      {
        en: 'It separates voluntary churn (price, missing feature) from involuntary churn (institute closed, moved).',
        hi: 'इससे अपनी मर्ज़ी से छोड़ने (कीमत, फ़ीचर की कमी) और मजबूरी में छोड़ने (संस्थान बंद, शिफ़्ट) का फ़र्क दिखता है।',
      },
      {
        en: 'Use the same wording for the same reason every time, so retention analysis stays useful.',
        hi: 'एक ही कारण के लिए हर बार एक जैसे शब्द लिखें, ताकि रिटेंशन का एनालिसिस काम का रहे।',
      },
    ],
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
        en: 'The net difference is invoiced (if positive) or credited (if negative) at the next billing cycle.',
        hi: 'बचा हुआ फ़र्क अगली बिलिंग साइकिल में इनवॉइस होता है (प्लस हो तो) या क्रेडिट होता है (माइनस हो तो)।',
      },
    ],
  },
});
