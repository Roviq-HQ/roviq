import type { EmploymentType, SocialCategory } from '@roviq/common-types';
import { defineFieldHelp, helpOptions } from '@roviq/ui';

export const staffNewHelp = defineFieldHelp('staff.new', {
  socialCategory: {
    title: { en: 'Social category', hi: 'सामाजिक श्रेणी' },
    hint: {
      en: 'Reported in government staff returns.',
      hi: 'सरकारी स्टाफ रिटर्न में दर्ज होती है।',
    },
    body: {
      en: 'The government classification of the staff member. It is printed in the board staff statement and the Shala Darpan staff return. It is not shown on staff lists or ID cards.',
      hi: 'स्टाफ सदस्य का सरकारी वर्गीकरण। यह बोर्ड स्टाफ विवरण और शाला दर्पण स्टाफ रिटर्न में छपता है। यह स्टाफ सूची या ID कार्ड पर नहीं दिखता।',
    },
    options: helpOptions<SocialCategory>({
      GENERAL: { en: 'No reservation category.', hi: 'कोई आरक्षण श्रेणी नहीं।' },
      OBC: { en: 'Other Backward Class.', hi: 'अन्य पिछड़ा वर्ग।' },
      SC: { en: 'Scheduled Caste.', hi: 'अनुसूचित जाति।' },
      ST: { en: 'Scheduled Tribe.', hi: 'अनुसूचित जनजाति।' },
      EWS: { en: 'Economically Weaker Section.', hi: 'आर्थिक रूप से कमज़ोर वर्ग।' },
    }),
  },
  employeeId: {
    title: { en: 'Employee ID', hi: 'कर्मचारी ID' },
    hint: {
      en: 'Leave it blank to get the next number.',
      hi: 'अगली संख्या पाने के लिए इसे खाली छोड़ें।',
    },
    body: {
      en: "Your institute's own code for this person, printed in staff exports and returns. It is not the Aadhaar, PAN or any government ID. No two current staff can share one. Left blank, the next number of the series (EMP-0001, EMP-0002, …) is given.",
      hi: 'इस व्यक्ति के लिए आपके संस्थान का अपना कोड, जो स्टाफ एक्सपोर्ट और रिटर्न में छपता है। यह आधार, PAN या कोई सरकारी ID नहीं है। दो मौजूदा स्टाफ सदस्यों का एक ही ID नहीं हो सकता। खाली छोड़ने पर श्रृंखला की अगली संख्या (EMP-0001, EMP-0002, …) दी जाती है।',
    },
    example: { en: 'EMP-1001, T-2025-045', hi: 'EMP-1001, T-2025-045' },
  },
  designation: {
    title: { en: 'Designation', hi: 'पद' },
    body: {
      en: 'The job title as it should appear in the board staff statement and other official returns. Use the title your board recognises, not a nickname. Staff lists can be filtered by it.',
      hi: 'पद का नाम, जैसा बोर्ड स्टाफ विवरण और अन्य आधिकारिक रिटर्न में दिखना चाहिए। उपनाम नहीं, बोर्ड द्वारा मान्य पद लिखें। स्टाफ सूची इसके अनुसार फ़िल्टर की जा सकती है।',
    },
    example: {
      en: 'PGT Physics, TGT English, Principal, Accountant, Librarian',
      hi: 'PGT भौतिकी, TGT अंग्रेज़ी, प्रधानाचार्य, लेखाकार, पुस्तकालयाध्यक्ष',
    },
  },
  department: {
    title: { en: 'Department', hi: 'विभाग' },
    body: {
      en: 'The group this person belongs to, printed in the board staff statement. For teachers use the subject department; for other staff the office they work in.',
      hi: 'यह व्यक्ति जिस समूह से जुड़ा है, यह बोर्ड स्टाफ विवरण में छपता है। शिक्षकों के लिए विषय विभाग लिखें; अन्य स्टाफ के लिए वह कार्यालय जहाँ वे काम करते हैं।',
    },
    example: {
      en: 'Science, Mathematics, Commerce, Administration, Accounts',
      hi: 'विज्ञान, गणित, वाणिज्य, प्रशासन, लेखा',
    },
  },
  employmentType: {
    title: { en: 'Employment type', hi: 'रोज़गार प्रकार' },
    hint: {
      en: 'Left blank, Regular is saved.',
      hi: 'खाली छोड़ने पर नियमित सहेजा जाता है।',
    },
    body: {
      en: 'The kind of contract this person is on. It is printed as the nature of appointment in the board staff statement. Pick the one that matches the appointment letter.',
      hi: 'इस व्यक्ति के अनुबंध का प्रकार। यह बोर्ड स्टाफ विवरण में नियुक्ति के प्रकार के रूप में छपता है। वही चुनें जो नियुक्ति पत्र से मेल खाता हो।',
    },
    options: helpOptions<EmploymentType>({
      REGULAR: { en: 'Permanent, full time.', hi: 'स्थायी, पूर्णकालिक।' },
      CONTRACTUAL: { en: 'Fixed term with an end date.', hi: 'समाप्ति तिथि वाला तय अवधि का अनुबंध।' },
      PART_TIME: { en: 'Fewer hours than regular staff.', hi: 'नियमित स्टाफ से कम घंटे।' },
      GUEST: { en: 'Paid per lecture or visit.', hi: 'प्रति व्याख्यान या विज़िट भुगतान।' },
      VOLUNTEER: { en: 'Unpaid or honorarium only.', hi: 'अवैतनिक या केवल मानदेय।' },
    }),
  },
});
