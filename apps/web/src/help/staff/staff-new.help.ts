import type { EmploymentType, SocialCategory } from '@roviq/common-types';
import { defineFieldHelp, helpOptions } from '@roviq/ui';

export const staffNewHelp = defineFieldHelp('staff.new', {
  socialCategory: {
    title: { en: 'Social category', hi: 'कैटेगरी (सामाजिक वर्ग)' },
    hint: {
      en: 'Reported in government staff returns.',
      hi: 'सरकारी स्टाफ रिटर्न में दर्ज होती है।',
    },
    body: {
      en: 'The government classification of the staff member.',
      hi: 'स्टाफ मेंबर की सरकारी कैटेगरी।',
    },
    points: [
      {
        en: 'It is printed in the board staff statement and the Shala Darpan staff return.',
        hi: 'यह बोर्ड स्टाफ स्टेटमेंट और शाला दर्पण स्टाफ रिटर्न में छपती है।',
      },
      {
        en: 'It is not shown on staff lists or ID cards.',
        hi: 'यह स्टाफ लिस्ट या ID कार्ड पर नहीं दिखती।',
      },
    ],
    options: helpOptions<SocialCategory>({
      GENERAL: { en: 'No reservation category.', hi: 'कोई रिज़र्वेशन कैटेगरी नहीं।' },
      OBC: { en: 'Other Backward Class.', hi: 'अन्य पिछड़ा वर्ग।' },
      SC: { en: 'Scheduled Caste.', hi: 'अनुसूचित जाति।' },
      ST: { en: 'Scheduled Tribe.', hi: 'अनुसूचित जनजाति।' },
      EWS: { en: 'Economically Weaker Section.', hi: 'आर्थिक रूप से कमज़ोर वर्ग।' },
    }),
  },
  employeeId: {
    title: { en: 'Employee ID', hi: 'एम्प्लॉई ID' },
    hint: {
      en: 'Leave it blank to get the next number.',
      hi: 'अगला नंबर पाने के लिए इसे खाली छोड़ें।',
    },
    body: {
      en: "Your institute's own code for this person, printed in staff exports and returns.",
      hi: 'इस व्यक्ति के लिए आपके संस्थान का अपना कोड, जो स्टाफ एक्सपोर्ट और रिटर्न में छपता है।',
    },
    points: [
      {
        en: 'It is not the Aadhaar, PAN or any government ID.',
        hi: 'यह आधार, PAN या कोई सरकारी ID नहीं है।',
      },
      {
        en: 'No two current staff can share one.',
        hi: 'दो मौजूदा स्टाफ का एक ही ID नहीं हो सकता।',
      },
      {
        en: 'Left blank, the next number of the series (EMP-0001, EMP-0002, …) is given.',
        hi: 'खाली छोड़ने पर सीरीज़ का अगला नंबर (EMP-0001, EMP-0002, …) मिल जाता है।',
      },
    ],
    example: { en: 'EMP-1001, T-2025-045', hi: 'EMP-1001, T-2025-045' },
  },
  designation: {
    title: { en: 'Designation', hi: 'पद' },
    body: {
      en: 'The job title as it should appear in the board staff statement and other official returns.',
      hi: 'पद का नाम, जैसा बोर्ड स्टाफ स्टेटमेंट और दूसरे सरकारी रिटर्न में दिखना चाहिए।',
    },
    points: [
      {
        en: 'Use the title your board recognises, not a nickname.',
        hi: 'बोर्ड जो पद मानता है वही लिखें, घर का नाम या उपनाम नहीं।',
      },
      {
        en: 'Staff lists can be filtered by it.',
        hi: 'स्टाफ लिस्ट को इससे फ़िल्टर किया जा सकता है।',
      },
    ],
    example: {
      en: 'PGT Physics, TGT English, Principal, Accountant, Librarian',
      hi: 'PGT फ़िज़िक्स, TGT इंग्लिश, प्रिंसिपल, अकाउंटेंट, लाइब्रेरियन',
    },
  },
  department: {
    title: { en: 'Department', hi: 'डिपार्टमेंट' },
    body: {
      en: 'The group this person belongs to, printed in the board staff statement.',
      hi: 'यह व्यक्ति जिस समूह से जुड़ा है, यह बोर्ड स्टाफ स्टेटमेंट में छपता है।',
    },
    points: [
      {
        en: 'For teachers use the subject department.',
        hi: 'टीचर के लिए विषय का डिपार्टमेंट लिखें।',
      },
      {
        en: 'For other staff use the office they work in.',
        hi: 'बाकी स्टाफ के लिए वह दफ़्तर लिखें जहाँ वे काम करते हैं।',
      },
    ],
    example: {
      en: 'Science, Mathematics, Commerce, Administration, Accounts',
      hi: 'साइंस, मैथ्स, कॉमर्स, एडमिनिस्ट्रेशन, अकाउंट्स',
    },
  },
  employmentType: {
    title: { en: 'Employment type', hi: 'नौकरी का टाइप' },
    hint: {
      en: 'Left blank, Regular is saved.',
      hi: 'खाली छोड़ने पर रेगुलर सेव होता है।',
    },
    body: {
      en: 'The kind of contract this person is on.',
      hi: 'इस व्यक्ति की नौकरी किस तरह की है।',
    },
    points: [
      {
        en: 'It is printed as the nature of appointment in the board staff statement.',
        hi: 'यह बोर्ड स्टाफ स्टेटमेंट में नियुक्ति के टाइप के रूप में छपता है।',
      },
      {
        en: 'Pick the one that matches the appointment letter.',
        hi: 'वही चुनें जो अपॉइंटमेंट लेटर से मेल खाए।',
      },
    ],
    options: helpOptions<EmploymentType>({
      REGULAR: { en: 'Permanent, full time.', hi: 'पक्की, फ़ुल टाइम।' },
      CONTRACTUAL: {
        en: 'Fixed term with an end date.',
        hi: 'खत्म होने की तारीख वाला तय अवधि का कॉन्ट्रैक्ट।',
      },
      PART_TIME: { en: 'Fewer hours than regular staff.', hi: 'रेगुलर स्टाफ से कम घंटे।' },
      GUEST: { en: 'Paid per lecture or visit.', hi: 'हर लेक्चर या विज़िट के हिसाब से पैसे।' },
      VOLUNTEER: { en: 'Unpaid or honorarium only.', hi: 'बिना सैलरी या सिर्फ़ मानदेय।' },
    }),
  },
});
