import type { EnquirySource } from '@roviq/common-types';
import { defineFieldHelp, helpOptions } from '@roviq/ui';

export const enquiryHelp = defineFieldHelp('admission.enquiry', {
  source: {
    title: { en: 'Source', hi: 'स्रोत' },
    body: {
      en: 'How the family first heard about your institute. Admission statistics count enquiries and applications per source, so you can see which channels bring families who apply. Pick a specific source over Other when you can.',
      hi: 'परिवार को आपके संस्थान के बारे में सबसे पहले कहाँ से पता चला। प्रवेश आँकड़े हर स्रोत की पूछताछ और आवेदन गिनते हैं, ताकि आप देख सकें कि कौन से माध्यम आवेदन करने वाले परिवार लाते हैं। जहाँ संभव हो, अन्य के बजाय कोई विशिष्ट स्रोत चुनें।',
    },
    options: helpOptions<EnquirySource>({
      REFERRAL: {
        en: 'Sent by a parent, student or staff member: fill Referred by too.',
        hi: 'किसी अभिभावक, विद्यार्थी या कर्मचारी ने भेजा: संदर्भित भी भरें।',
      },
      ALUMNI: {
        en: 'Came through your former students.',
        hi: 'आपके पूर्व विद्यार्थियों के माध्यम से आए।',
      },
      GOOGLE: { en: 'A Google search or Google ad.', hi: 'गूगल सर्च या गूगल विज्ञापन।' },
      SOCIAL_MEDIA: {
        en: 'A post, ad or message on Instagram, Facebook or YouTube.',
        hi: 'Instagram, Facebook या YouTube पर पोस्ट, विज्ञापन या संदेश।',
      },
      WHATSAPP: {
        en: 'A WhatsApp chat or broadcast.',
        hi: 'व्हाट्सऐप चैट या ब्रॉडकास्ट।',
      },
      OTHER: {
        en: 'None of the above: say how in Notes.',
        hi: 'ऊपर में से कोई नहीं: टिप्पणियाँ में बताएँ कैसे।',
      },
    }),
  },
  followUpDate: {
    title: { en: 'Follow-up date', hi: 'फ़ॉलो-अप तिथि' },
    hint: {
      en: 'Overdue enquiries are listed first.',
      hi: 'जिनकी तिथि निकल गई, वे पूछताछ सूची में सबसे ऊपर आती हैं।',
    },
    body: {
      en: 'When someone should contact this family next. The enquiry list shows enquiries whose follow-up date has passed first, marked as overdue, then the rest by this date. No message is sent automatically. Leave it blank if the family asked not to be called.',
      hi: 'इस परिवार से अगली बार कब संपर्क करना है। पूछताछ सूची में वे पूछताछ पहले दिखती हैं जिनकी फ़ॉलो-अप तिथि निकल गई है, "देर से" के निशान के साथ, फिर बाकी इसी तिथि के क्रम में। कोई संदेश अपने आप नहीं जाता। यदि परिवार ने कॉल न करने को कहा हो तो खाली छोड़ें।',
    },
  },
});
