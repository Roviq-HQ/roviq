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
  postalCode: {
    title: { en: 'PIN code', hi: 'पिन कोड' },
    body: {
      en: 'The 6-digit PIN code of the address, as India Post gives it.',
      hi: 'पते का 6 अंकों का पिन कोड, जैसा इंडिया पोस्ट देता है।',
    },
    points: [
      {
        en: 'When you leave the box, Roviq fills the city, district and state from it, if they are empty.',
        hi: 'बॉक्स से बाहर निकलते ही Roviq इससे शहर, ज़िला और राज्य भर देता है, अगर वे खाली हों।',
      },
      {
        en: 'It never overwrites what you typed, and you can still change those fields.',
        hi: 'आपकी लिखी जानकारी नहीं बदलता, और आप ये फ़ील्ड बाद में भी बदल सकते हैं।',
      },
    ],
    example: { en: '122001', hi: '122001' },
  },
  coordinates: {
    title: { en: 'Latitude and longitude', hi: 'लैटिट्यूड और लॉन्गिट्यूड' },
    body: {
      en: 'The map position of the institute. Optional: Roviq only saves it with the address.',
      hi: 'मैप पर संस्थान की जगह। ज़रूरी नहीं: Roviq इसे सिर्फ़ पते के साथ सेव करता है।',
    },
    points: [
      {
        en: 'To find them, right-click the institute on Google Maps; the first line of the menu shows both numbers.',
        hi: 'इन्हें पाने के लिए Google Maps पर संस्थान पर राइट-क्लिक करें; मेन्यू की पहली लाइन में दोनों नंबर दिखते हैं।',
      },
    ],
    example: { en: '28.4595, 77.0266', hi: '28.4595, 77.0266' },
  },
});
