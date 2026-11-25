import { defineFieldHelp } from '@roviq/ui';

export const refundHelp = defineFieldHelp('resellerBilling.refund', {
  amount: {
    title: { en: 'Refund amount', hi: 'रिफ़ंड की रकम' },
    body: {
      en: 'How much to return to the payer, in rupees.',
      hi: 'पेमेंट देने वाले को कितना लौटाना है, रुपये में।',
    },
    points: [
      {
        en: 'It can be less than the payment if you keep a cancellation fee or an adjustment.',
        hi: 'कैंसिलेशन फ़ीस या ऐडजस्टमेंट रखना हो तो यह पेमेंट से कम हो सकती है।',
      },
      {
        en: 'It must not be more than the balance not yet refunded, shown at the top of this dialog.',
        hi: 'यह उस बची रकम से ज़्यादा नहीं हो सकती जो अभी रिफ़ंड नहीं हुई, जो इस डायलॉग में ऊपर दिखती है।',
      },
    ],
  },
  reason: {
    title: { en: 'Reason', hi: 'कारण' },
    body: {
      en: 'Why the money is returned. It is needed for the audit and for the GST credit note.',
      hi: 'पैसा क्यों लौटाया जा रहा है। यह ऑडिट और GST क्रेडिट नोट के लिए चाहिए।',
    },
    points: [
      {
        en: 'Be specific.',
        hi: 'साफ़ और खास कारण लिखें।',
      },
    ],
    example: {
      en: 'Duplicate payment · Admission withdrawn within the 7-day cooling-off · Service not delivered',
      hi: 'डुप्लिकेट पेमेंट · 7 दिन की कूलिंग-ऑफ़ में एडमिशन वापस लिया · सर्विस नहीं मिली',
    },
    avoid: {
      en: 'A generic reason like "Refund". It fails finance review and delays the payer.',
      hi: '"रिफ़ंड" जैसा आम कारण। फ़ाइनेंस की जाँच में अटक जाता है और पेमेंट देने वाले को देर होती है।',
    },
  },
});
