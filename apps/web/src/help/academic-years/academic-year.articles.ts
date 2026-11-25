import type { HelpArticle } from '@roviq/ui';

export const sessionDates: HelpArticle = {
  title: { en: 'Academic year dates', hi: 'शैक्षणिक वर्ष की तिथियाँ' },
  sections: [
    {
      heading: { en: 'Years cannot overlap', hi: 'वर्ष आपस में ओवरलैप नहीं हो सकते' },
      warning: {
        en: 'Except in coaching institutes, two academic years cannot share a single day. Saving a year whose dates touch another year is refused.',
        hi: 'कोचिंग संस्थानों को छोड़कर, दो शैक्षणिक वर्षों में एक भी दिन साझा नहीं हो सकता। किसी दूसरे वर्ष की तिथियों से टकराने वाला वर्ष सहेजा नहीं जाता।',
      },
    },
    {
      heading: { en: 'What the dates mean', hi: 'तिथियों का अर्थ' },
      paragraphs: [
        {
          en: 'The start date is the first working day of the session and the end date is the last. The start date must come before the end date.',
          hi: 'प्रारंभ तिथि सत्र का पहला कार्य दिवस है और समाप्ति तिथि अंतिम। प्रारंभ तिथि समाप्ति तिथि से पहले होनी चाहिए।',
        },
      ],
    },
    {
      heading: { en: 'Setting up the next year', hi: 'अगला वर्ष बनाना' },
      steps: [
        {
          en: 'Open the current year and note its end date.',
          hi: 'वर्तमान वर्ष खोलें और उसकी समाप्ति तिथि देखें।',
        },
        {
          en: 'Start the new year on the day after that date, for example 1 April 2026 after 31 March 2026.',
          hi: 'नया वर्ष उस तिथि के अगले दिन से शुरू करें, जैसे 31 मार्च 2026 के बाद 1 अप्रैल 2026।',
        },
      ],
    },
  ],
};
