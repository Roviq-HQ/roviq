import { defineFieldHelp, helpOptions } from '@roviq/ui';

export const planFormHelp = defineFieldHelp('resellerBilling.plan', {
  code: {
    title: { en: 'Plan code', hi: 'प्लान का कोड' },
    body: {
      en: 'The short code the system uses for this plan in API calls, audit logs and reports. Institutes never see it.',
      hi: 'सिस्टम में इस प्लान का छोटा कोड, जो API कॉल, ऑडिट लॉग और रिपोर्ट में चलता है। संस्थान इसे नहीं देखते।',
    },
    points: [
      {
        en: 'Keep it short, stable and easy to recognise.',
        hi: 'छोटा, पक्का और आसानी से पहचाना जाने वाला रखें।',
      },
      {
        en: 'It cannot be changed later, because that would break the reports.',
        hi: 'बाद में बदला नहीं जा सकता, वरना रिपोर्ट का सिलसिला टूट जाएगा।',
      },
    ],
    example: { en: 'PRO · STARTER-24 · ENTERPRISE_V2', hi: 'PRO · STARTER-24 · ENTERPRISE_V2' },
    avoid: {
      en: 'Timestamps, UUIDs or internal ticket numbers.',
      hi: 'टाइमस्टैम्प, UUID या इंटरनल टिकट नंबर।',
    },
  },
  amount: {
    title: { en: 'Amount', hi: 'रकम' },
    body: {
      en: 'The price for one billing cycle, in Indian rupees.',
      hi: 'एक बिलिंग साइकिल की कीमत, रुपये में।',
    },
    points: [
      {
        en: 'It is stored in paise and shown in Indian numbering.',
        hi: 'यह पैसे में सेव होती है और इंडियन नंबरिंग में दिखती है।',
      },
    ],
    example: { en: '₹1,00,000', hi: '₹1,00,000' },
  },
  interval: {
    title: { en: 'Billing interval', hi: 'बिलिंग का अंतराल' },
    body: {
      en: 'How often the institute is charged.',
      hi: 'संस्थान से कितनी बार पैसे लिए जाएँगे।',
    },
    points: [
      {
        en: 'Longer intervals usually give a discount and fewer failed payments, but tie the institute in for longer.',
        hi: 'लंबा अंतराल आम तौर पर डिस्काउंट देता है और फ़ेल पेमेंट कम करता है, पर संस्थान ज़्यादा समय के लिए बँध जाता है।',
      },
      {
        en: 'Switching in the middle of a cycle creates a prorated invoice.',
        hi: 'साइकिल के बीच में बदलने पर प्रो-रेटेड इनवॉइस बनता है।',
      },
    ],
    options: helpOptions<'MONTHLY' | 'QUARTERLY' | 'SEMI_ANNUAL' | 'ANNUAL'>({
      MONTHLY: { en: 'Every month. Most flexible.', hi: 'हर महीने। सबसे आसान।' },
      QUARTERLY: { en: 'Every 3 months, small discount.', hi: 'हर 3 महीने में, थोड़ा डिस्काउंट।' },
      SEMI_ANNUAL: {
        en: 'Every 6 months, matches institute fee cycles.',
        hi: 'हर 6 महीने में, संस्थान की फ़ीस साइकिल से मेल खाता है।',
      },
      ANNUAL: {
        en: 'Once a year. Best for large contracts and GST.',
        hi: 'साल में एक बार। बड़े कॉन्ट्रैक्ट और GST के लिए सबसे अच्छा।',
      },
    }),
  },
  trialDays: {
    title: { en: 'Trial days', hi: 'ट्रायल के दिन' },
    body: {
      en: 'Days the institute uses the plan free before the first invoice.',
      hi: 'पहले इनवॉइस से पहले संस्थान जितने दिन प्लान मुफ़्त चलाता है।',
    },
    points: [
      {
        en: 'A trial is given once per institute per plan.',
        hi: 'ट्रायल हर संस्थान को हर प्लान पर एक ही बार मिलता है।',
      },
      {
        en: 'Giving the plan again after the trial ended starts paid billing at once.',
        hi: 'ट्रायल खत्म होने के बाद वही प्लान दोबारा देने पर पेड बिलिंग तुरंत शुरू हो जाती है।',
      },
      {
        en: 'Leave 0 if the sale was done offline and the institute pays from day one.',
        hi: 'सेल ऑफ़लाइन हो चुकी हो और संस्थान पहले दिन से पेमेंट करे तो 0 रखें।',
      },
    ],
  },
  limits: {
    title: { en: 'Capacity limits', hi: 'क्षमता की सीमा' },
    body: {
      en: 'Hard caps the platform enforces for this plan.',
      hi: 'इस प्लान पर प्लेटफ़ॉर्म की तरफ़ से लगी पक्की सीमाएँ।',
    },
    points: [
      {
        en: 'When an institute hits a limit, the next create action is blocked with an error that points to the Upgrade page.',
        hi: 'सीमा पर पहुँचने पर अगला नया रिकॉर्ड बनाना रुक जाता है और एरर में अपग्रेड पेज बताया जाता है।',
      },
      {
        en: 'Leave a field blank for unlimited (enterprise).',
        hi: 'कोई फ़ील्ड खाली छोड़ने पर वह अनलिमिटेड होती है (एंटरप्राइज़)।',
      },
      {
        en: 'Limits apply per institute, not across all institutes on the plan.',
        hi: 'सीमा हर संस्थान पर अलग लगती है, प्लान के सारे संस्थानों पर मिलाकर नहीं।',
      },
    ],
    example: {
      en: 'A Starter plan: 200 students, 20 staff, 500 MB storage. At 201 students, adding a student is blocked and an upgrade is offered.',
      hi: 'स्टार्टर प्लान: 200 स्टूडेंट, 20 स्टाफ, 500 MB स्टोरेज। 201वाँ स्टूडेंट जोड़ने पर रुक जाता है और अपग्रेड का सुझाव दिखता है।',
    },
  },
});
