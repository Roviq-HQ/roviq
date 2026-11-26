import { defineFieldHelp } from '@roviq/ui';

export const gatewayConfigHelp = defineFieldHelp('resellerBilling.gateway', {
  vpa: {
    title: { en: 'UPI VPA address', hi: 'UPI VPA एड्रेस' },
    body: {
      en: 'The UPI address where manual UPI payments are collected, when the gateway does not handle UPI directly.',
      hi: 'वह UPI एड्रेस जहाँ मैनुअल UPI पेमेंट आते हैं, जब गेटवे UPI खुद नहीं सँभालता।',
    },
    points: [
      {
        en: 'Your institutes see it on their invoices as the UPI address to pay to.',
        hi: 'आपके संस्थान इसे अपने इनवॉइस पर, पेमेंट भेजने के UPI एड्रेस की तरह देखते हैं।',
      },
      {
        en: 'The bank must support UPI Collect on this address: check before publishing.',
        hi: 'बैंक को इस एड्रेस पर UPI Collect चालू रखना होगा: पब्लिश करने से पहले जाँच लें।',
      },
    ],
    example: { en: 'institute@hdfcbank', hi: 'institute@hdfcbank' },
  },
  keyId: {
    title: { en: 'Key ID', hi: 'की ID' },
    body: {
      en: 'The public API ID from your gateway dashboard.',
      hi: 'गेटवे डैशबोर्ड से मिली पब्लिक API ID।',
    },
    points: [
      {
        en: 'It goes with every API call and shows in the browser network tab, so it is safe to share with support.',
        hi: 'यह हर API कॉल के साथ जाती है और ब्राउज़र के नेटवर्क टैब में दिखती है, इसलिए सपोर्ट को बताना सुरक्षित है।',
      },
    ],
    example: {
      en: 'rzp_live_… (Razorpay) · CF_PROD_… (Cashfree)',
      hi: 'rzp_live_… (Razorpay) · CF_PROD_… (Cashfree)',
    },
    avoid: {
      en: 'The test key in production. Live payments will not work.',
      hi: 'प्रोडक्शन में टेस्ट की। लाइव पेमेंट नहीं चलेंगे।',
    },
  },
  keySecret: {
    title: { en: 'Key Secret', hi: 'की सीक्रेट' },
    body: {
      en: 'The private signing key that goes with the Key ID.',
      hi: 'Key ID के साथ वाली प्राइवेट साइनिंग की।',
    },
    points: [
      {
        en: 'It is stored encrypted and is never shown again after you save.',
        hi: 'यह एन्क्रिप्ट होकर सेव होती है और सेव के बाद दोबारा नहीं दिखती।',
      },
      {
        en: 'If it leaks, rotate it in the gateway dashboard, paste the new value here and replace the webhook secret too.',
        hi: 'लीक हो जाए तो गेटवे डैशबोर्ड में बदलें, नई वैल्यू यहाँ डालें और वेबहुक सीक्रेट भी बदल दें।',
      },
    ],
  },
  webhookSecret: {
    title: { en: 'Webhook secret', hi: 'वेबहुक सीक्रेट' },
    body: {
      en: 'The secret used to check that incoming webhook events really came from the gateway.',
      hi: 'वह सीक्रेट जिससे जाँचा जाता है कि वेबहुक इवेंट सच में गेटवे से आए हैं।',
    },
    points: [
      {
        en: 'Copy the exact value the gateway gave you when you set up the webhook.',
        hi: 'वेबहुक सेट करते समय गेटवे ने जो वैल्यू दी, ठीक वही कॉपी करें।',
      },
    ],
    avoid: {
      en: 'A value that does not match. Every payment notification is dropped without any error, so payments look like they are not reconciling.',
      hi: 'मेल न खाने वाली वैल्यू। हर पेमेंट नोटिफ़िकेशन बिना किसी एरर के छूट जाता है, और पेमेंट मैच होते नहीं दिखते।',
    },
  },
  testMode: {
    title: { en: 'Test mode', hi: 'टेस्ट मोड' },
    body: {
      en: 'A label that says these are test keys. Roviq saves it but does not change how payments go through.',
      hi: 'एक लेबल, जो बताता है कि ये टेस्ट की हैं। Roviq इसे सेव करता है, पर पेमेंट का तरीका नहीं बदलता।',
    },
    points: [
      {
        en: 'Whether real money moves depends on the keys: test keys from the gateway take only test payments.',
        hi: 'असली पैसा कटेगा या नहीं, यह की से तय होता है: गेटवे की टेस्ट की सिर्फ़ टेस्ट पेमेंट लेती हैं।',
      },
      {
        en: 'Turn it on only for test keys, so everyone can see which config is for testing.',
        hi: 'इसे सिर्फ़ टेस्ट की के लिए चालू करें, ताकि सबको पता रहे कि कौन सा कॉन्फ़िग टेस्ट के लिए है।',
      },
    ],
  },
  defaultGateway: {
    title: { en: 'Default gateway', hi: 'डिफ़ॉल्ट गेटवे' },
    body: {
      en: 'The gateway that takes the online payments of all your institutes.',
      hi: 'वह गेटवे जिससे आपके सभी संस्थानों के ऑनलाइन पेमेंट आते हैं।',
    },
    points: [
      {
        en: 'Only one gateway can be the default: marking this one unmarks the old one.',
        hi: 'एक ही गेटवे डिफ़ॉल्ट हो सकता है: इसे चुनने पर पुराना हट जाता है।',
      },
      {
        en: 'Changing the default moves every later payment, existing subscriptions included, to the new gateway.',
        hi: 'डिफ़ॉल्ट बदलने पर आगे के सारे पेमेंट, पुराने सब्सक्रिप्शन के भी, नए गेटवे से होते हैं।',
      },
    ],
  },
});
