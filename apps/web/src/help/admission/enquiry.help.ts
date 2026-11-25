import type { EnquirySource } from '@roviq/common-types';
import { defineFieldHelp, helpOptions } from '@roviq/ui';

export const enquiryHelp = defineFieldHelp('admission.enquiry', {
  source: {
    title: { en: 'Source', hi: 'सोर्स' },
    body: {
      en: 'How the family first heard about your institute.',
      hi: 'परिवार को आपके संस्थान के बारे में सबसे पहले कहाँ से पता चला।',
    },
    points: [
      {
        en: 'Admission statistics count enquiries and applications per source.',
        hi: 'एडमिशन के आँकड़े हर सोर्स की पूछताछ और ऐप्लिकेशन गिनते हैं।',
      },
      {
        en: 'So you can see which channels bring families who apply.',
        hi: 'इससे दिखता है कि किस रास्ते से ऐप्लिकेशन देने वाले परिवार आते हैं।',
      },
      {
        en: 'Pick a specific source over Other when you can.',
        hi: 'हो सके तो अन्य की जगह कोई खास सोर्स चुनें।',
      },
    ],
    options: helpOptions<EnquirySource>({
      REFERRAL: {
        en: 'Sent by a parent, student or staff member: fill Referred by too.',
        hi: 'किसी पेरेंट, स्टूडेंट या स्टाफ ने भेजा: रेफ़र करने वाले का नाम भी भरें।',
      },
      ALUMNI: {
        en: 'Came through your former students.',
        hi: 'आपके पुराने स्टूडेंट्स के ज़रिए आए।',
      },
      GOOGLE: { en: 'A Google search or Google ad.', hi: 'गूगल सर्च या गूगल का विज्ञापन।' },
      SOCIAL_MEDIA: {
        en: 'A post, ad or message on Instagram, Facebook or YouTube.',
        hi: 'Instagram, Facebook या YouTube पर पोस्ट, विज्ञापन या मैसेज।',
      },
      WHATSAPP: {
        en: 'A WhatsApp chat or broadcast.',
        hi: 'व्हाट्सऐप चैट या ब्रॉडकास्ट।',
      },
      OTHER: {
        en: 'None of the above: say how in Notes.',
        hi: 'ऊपर में से कोई नहीं: नोट्स में बताएँ कैसे।',
      },
    }),
  },
  followUpDate: {
    title: { en: 'Follow-up date', hi: 'फ़ॉलो-अप की तारीख' },
    hint: {
      en: 'Overdue enquiries are listed first.',
      hi: 'जिनकी तारीख निकल गई, वे पूछताछ लिस्ट में सबसे ऊपर आती हैं।',
    },
    body: {
      en: 'When someone should contact this family next.',
      hi: 'इस परिवार से अगली बार कब बात करनी है।',
    },
    points: [
      {
        en: 'Enquiries whose follow-up date has passed are listed first, marked as overdue; the rest follow in date order.',
        hi: 'जिन पूछताछ की फ़ॉलो-अप तारीख निकल गई है वे "देर से" के निशान के साथ पहले दिखती हैं; बाकी तारीख के क्रम में।',
      },
      {
        en: 'No message is sent automatically.',
        hi: 'कोई मैसेज अपने आप नहीं जाता।',
      },
      {
        en: 'Leave it blank if the family asked not to be called.',
        hi: 'अगर परिवार ने कॉल करने से मना किया है तो खाली छोड़ें।',
      },
    ],
  },
});
