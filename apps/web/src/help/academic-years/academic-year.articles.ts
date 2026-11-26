import type { HelpArticle } from '@roviq/ui';

export const sessionDates: HelpArticle = {
  title: { en: 'Academic year dates', hi: 'एकेडमिक ईयर की तारीखें' },
  sections: [
    {
      heading: { en: 'Years cannot overlap', hi: 'दो ईयर की तारीखें ओवरलैप नहीं हो सकतीं' },
      warning: {
        en: 'Except in coaching institutes, two academic years cannot share a single day. Saving a year whose dates touch another year is refused.',
        hi: 'कोचिंग संस्थानों को छोड़कर, दो एकेडमिक ईयर में एक भी दिन कॉमन नहीं हो सकता। जिस ईयर की तारीखें किसी दूसरे ईयर से टकराती हैं, वह सेव नहीं होता।',
      },
    },
    {
      heading: { en: 'What the dates mean', hi: 'तारीखों का मतलब' },
      paragraphs: [
        {
          en: 'The start date is the first working day of the session and the end date is the last. The start date must come before the end date.',
          hi: 'शुरू की तारीख सेशन का पहला वर्किंग डे है और आखिरी तारीख सेशन का आखिरी दिन। शुरू की तारीख आखिरी तारीख से पहले होनी चाहिए।',
        },
      ],
    },
    {
      heading: { en: 'Setting up the next year', hi: 'अगला ईयर बनाना' },
      steps: [
        {
          en: 'Open the current year and note its end date.',
          hi: 'अभी का ईयर खोलें और उसकी आखिरी तारीख देखें।',
        },
        {
          en: 'Start the new year on the day after that date, for example 1 April 2026 after 31 March 2026.',
          hi: 'नया ईयर उस तारीख के अगले दिन से शुरू करें, जैसे 31 मार्च 2026 के बाद 1 अप्रैल 2026।',
        },
      ],
    },
  ],
};
