import { defineFieldHelp, helpOptions } from '@roviq/ui';

export const recordPaymentHelp = defineFieldHelp('resellerBilling.recordPayment', {
  method: {
    title: { en: 'Payment method', hi: 'पेमेंट का तरीका' },
    body: {
      en: 'How the payment actually reached you.',
      hi: 'पेमेंट आप तक असल में कैसे पहुँचा।',
    },
    points: [
      {
        en: 'It decides which reconciliation report this payment appears in and whether it needs a manual check.',
        hi: 'इससे तय होता है कि पेमेंट किस रिकंसिलिएशन रिपोर्ट में आएगा और उसकी मैनुअल जाँच चाहिए या नहीं।',
      },
      {
        en: 'Pick the method you received, not the one on the invoice.',
        hi: 'जिस तरीके से पैसा मिला वही चुनें, इनवॉइस वाला नहीं।',
      },
    ],
    options: helpOptions<'CASH' | 'CHEQUE' | 'BANK_TRANSFER' | 'UPI'>({
      CASH: { en: 'Counter receipt.', hi: 'काउंटर पर रिसीट।' },
      CHEQUE: {
        en: 'The invoice is marked paid only after the cheque clears.',
        hi: 'चेक क्लियर होने के बाद ही इनवॉइस पेड होता है।',
      },
      BANK_TRANSFER: {
        en: 'NEFT, RTGS or IMPS straight to your account.',
        hi: 'NEFT, RTGS या IMPS सीधे आपके खाते में।',
      },
      UPI: {
        en: 'Any UPI payment (PhonePe, GPay, Paytm). The UTR still needs a manual check.',
        hi: 'कोई भी UPI पेमेंट (PhonePe, GPay, Paytm)। UTR की जाँच अभी मैनुअल करनी होती है।',
      },
    }),
  },
  receiptNumber: {
    title: { en: 'Receipt number', hi: 'रिसीट नंबर' },
    body: {
      en: "Your institute's own receipt number, the one printed on the receipt you hand to the payer.",
      hi: 'आपके संस्थान का अपना रिसीट नंबर, जो पेमेंट देने वाले को दी रिसीट पर छपा होता है।',
    },
    points: [
      {
        en: 'Tax audits match this number with the invoice for GST input credit.',
        hi: 'टैक्स ऑडिट में GST इनपुट क्रेडिट के लिए यह नंबर इनवॉइस से मिलाया जाता है।',
      },
      {
        en: 'For UPI and bank transfers, enter the UTR or transaction reference.',
        hi: 'UPI और बैंक ट्रांसफ़र में UTR या ट्रांज़ैक्शन रेफ़रेंस डालें।',
      },
    ],
  },
  collectionDate: {
    title: { en: 'Collection date', hi: 'पैसा मिलने की तारीख' },
    body: {
      en: 'The date the money was actually received, not the date you are recording it.',
      hi: 'वह तारीख जिस दिन पैसा सच में मिला, न कि जिस दिन आप एंट्री कर रहे हैं।',
    },
    points: [
      {
        en: 'For a cheque, use the date it cleared, not the date it was handed over.',
        hi: 'चेक में वह तारीख डालें जिस दिन वह क्लियर हुआ, देने की तारीख नहीं।',
      },
    ],
    avoid: {
      en: 'The cheque hand-over date. The ledger will show income that has not arrived yet.',
      hi: 'चेक देने की तारीख। लेजर में ऐसी कमाई दिखेगी जो अभी आई ही नहीं।',
    },
  },
});
