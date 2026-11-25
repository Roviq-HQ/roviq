import type { DomainGroupType, GroupMembershipType } from '@roviq/common-types';
import { defineFieldHelp, helpOptions } from '@roviq/ui';

export const groupNewHelp = defineFieldHelp('groups.new', {
  type: {
    title: { en: 'Group type', hi: 'समूह प्रकार' },
    hint: { en: 'Cannot be changed later.', hi: 'बाद में बदला नहीं जा सकता।' },
    body: {
      en: 'What the group is for. It sets the icon and label the group gets in the group list, and the list can be filtered by it. Pick the closest type rather than Custom. It cannot be changed after the group is created.',
      hi: 'समूह किस लिए है। इससे समूह सूची में समूह का आइकन और लेबल तय होता है, और सूची को इसके अनुसार छाँटा जा सकता है। कस्टम के बजाय सबसे निकट का प्रकार चुनें। समूह बनने के बाद इसे बदला नहीं जा सकता।',
    },
    options: helpOptions<DomainGroupType>({
      COMPOSITE: {
        en: 'Gathers the members of other groups.',
        hi: 'दूसरे समूहों के सदस्यों को एक साथ लेता है।',
      },
      CUSTOM: { en: 'Only when no other type fits.', hi: 'केवल तब जब कोई अन्य प्रकार न जमे।' },
    }),
  },
  membershipType: {
    title: { en: 'Membership type', hi: 'सदस्यता प्रकार' },
    hint: { en: 'Cannot be changed later.', hi: 'बाद में बदला नहीं जा सकता।' },
    body: {
      en: 'How people become members. It cannot be changed after the group is created, so choose it before saving.',
      hi: 'लोग सदस्य कैसे बनते हैं। समूह बनने के बाद इसे बदला नहीं जा सकता, इसलिए सहेजने से पहले चुनें।',
    },
    options: helpOptions<GroupMembershipType>({
      STATIC: {
        en: 'You add and remove each member yourself.',
        hi: 'आप हर सदस्य को स्वयं जोड़ते और हटाते हैं।',
      },
      DYNAMIC: {
        en: 'Members come from the rule you set in the Rule step.',
        hi: 'सदस्य नियम चरण में तय किए गए नियम से आते हैं।',
      },
      HYBRID: {
        en: 'The rule, plus people you add, minus people you exclude.',
        hi: 'नियम से आए सदस्य, आपके जोड़े गए लोग, और आपके बाहर किए गए लोगों को छोड़कर।',
      },
    }),
  },
  memberTypes: {
    title: { en: 'Who can be a member', hi: 'सदस्य कौन हो सकता है' },
    body: {
      en: 'The kinds of people the group is for: students, staff, guardians, or a mix such as a parent-teacher committee. It is saved with the group and cannot be changed after the group is created.',
      hi: 'समूह किस तरह के लोगों के लिए है: विद्यार्थी, स्टाफ, अभिभावक, या मिश्रण जैसे अभिभावक-शिक्षक समिति। यह समूह के साथ सहेजा जाता है और समूह बनने के बाद बदला नहीं जा सकता।',
    },
  },
});
