import { defineFieldHelp } from '@roviq/ui';

export const addressHelp = defineFieldHelp('instituteSettings.address', {
  stateFiltered: {
    title: { en: 'Why some states are missing', hi: 'कुछ राज्य क्यों नहीं दिख रहे' },
    body: {
      en: "Only the states covered by your institute's state board can be chosen here. If the state you need is missing, check the board affiliations of your institute or contact support.",
      hi: 'यहाँ केवल वही राज्य चुने जा सकते हैं जो आपके संस्थान के राज्य बोर्ड के अंतर्गत आते हैं। यदि आपका राज्य नहीं दिख रहा, तो अपने संस्थान की बोर्ड संबद्धता देखें या सहायता से संपर्क करें।',
    },
  },
});
