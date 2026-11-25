import type { DomainGroupType, GroupMembershipType } from '@roviq/common-types';
import { defineFieldHelp, helpOptions } from '@roviq/ui';

export const groupNewHelp = defineFieldHelp('groups.new', {
  type: {
    title: { en: 'Group type', hi: 'ग्रुप का टाइप' },
    hint: { en: 'Cannot be changed later.', hi: 'बाद में बदला नहीं जा सकता।' },
    body: {
      en: 'What the group is for.',
      hi: 'ग्रुप किस काम के लिए है।',
    },
    points: [
      {
        en: 'It sets the icon and label the group gets in the group list, and the list can be filtered by it.',
        hi: 'इससे ग्रुप लिस्ट में ग्रुप का आइकन और लेबल तय होता है, और लिस्ट को इसी से फ़िल्टर किया जा सकता है।',
      },
      {
        en: 'Pick the closest type rather than Custom.',
        hi: 'कस्टम की जगह सबसे मिलता-जुलता टाइप चुनें।',
      },
      {
        en: 'It cannot be changed after the group is created.',
        hi: 'ग्रुप बनने के बाद इसे बदला नहीं जा सकता।',
      },
    ],
    options: helpOptions<DomainGroupType>({
      COMPOSITE: {
        en: 'Gathers the members of other groups.',
        hi: 'दूसरे ग्रुप के मेंबर एक साथ लेता है।',
      },
      CUSTOM: { en: 'Only when no other type fits.', hi: 'सिर्फ़ तब जब कोई और टाइप न बैठे।' },
    }),
  },
  membershipType: {
    title: { en: 'Membership type', hi: 'मेंबरशिप का टाइप' },
    hint: { en: 'Cannot be changed later.', hi: 'बाद में बदला नहीं जा सकता।' },
    body: {
      en: 'How people become members.',
      hi: 'लोग मेंबर कैसे बनते हैं।',
    },
    points: [
      {
        en: 'It cannot be changed after the group is created, so choose it before saving.',
        hi: 'ग्रुप बनने के बाद इसे बदला नहीं जा सकता, इसलिए सेव करने से पहले चुनें।',
      },
    ],
    options: helpOptions<GroupMembershipType>({
      STATIC: {
        en: 'You add and remove each member yourself.',
        hi: 'हर मेंबर को आप खुद जोड़ते और हटाते हैं।',
      },
      DYNAMIC: {
        en: 'Members come from the rule you set in the Rule step.',
        hi: 'मेंबर उस नियम से आते हैं जो आपने नियम वाले स्टेप में तय किया।',
      },
      HYBRID: {
        en: 'The rule, plus people you add, minus people you exclude.',
        hi: 'नियम से आए मेंबर, साथ में आपके जोड़े लोग, और आपके हटाए लोग छोड़कर।',
      },
    }),
  },
  memberTypes: {
    title: { en: 'Who can be a member', hi: 'मेंबर कौन हो सकता है' },
    body: {
      en: 'The kinds of people the group is for: students, staff, guardians, or a mix such as a parent-teacher committee.',
      hi: 'ग्रुप किन लोगों के लिए है: स्टूडेंट, स्टाफ, अभिभावक, या मिलाजुला जैसे पेरेंट-टीचर कमेटी।',
    },
    points: [
      {
        en: 'It is saved with the group and cannot be changed after the group is created.',
        hi: 'यह ग्रुप के साथ सेव होता है और ग्रुप बनने के बाद बदला नहीं जा सकता।',
      },
    ],
  },
});
