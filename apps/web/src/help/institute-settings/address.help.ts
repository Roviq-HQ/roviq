import { defineFieldHelp } from '@roviq/ui';

export const addressHelp = defineFieldHelp('instituteSettings.address', {
  stateFiltered: {
    title: { en: 'Why some states are missing', hi: 'कुछ राज्य क्यों नहीं दिख रहे' },
    body: {
      en: "Only the states covered by your institute's state board can be chosen here.",
      hi: 'यहाँ सिर्फ़ वही राज्य चुने जा सकते हैं जो आपके संस्थान के स्टेट बोर्ड में आते हैं।',
    },
    points: [
      {
        en: "If the state you need is missing, check your institute's board affiliations or contact support.",
        hi: 'अगर आपका राज्य नहीं दिख रहा, तो संस्थान की बोर्ड अफ़िलिएशन देखें या सपोर्ट से बात करें।',
      },
    ],
  },
});
