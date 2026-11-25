import type { AttendanceType } from '@roviq/common-types';
import { defineFieldHelp, helpOptions } from '@roviq/ui';

export const instituteConfigHelp = defineFieldHelp('instituteSettings.config', {
  attendanceType: {
    title: { en: 'Attendance type', hi: 'उपस्थिति प्रकार' },
    body: {
      en: 'How your institute records attendance: once a day, or once per period. It is saved with your settings and shown to the platform team. The attendance screens work the same way for either choice.',
      hi: 'आपका संस्थान उपस्थिति कैसे दर्ज करता है: दिन में एक बार, या हर कालांश में। यह आपकी सेटिंग्स के साथ सहेजा जाता है और प्लेटफ़ॉर्म टीम को दिखता है। उपस्थिति स्क्रीन दोनों विकल्पों में एक जैसी चलती हैं।',
    },
    options: helpOptions<AttendanceType>({
      DAILY: { en: 'One mark per student per day.', hi: 'हर विद्यार्थी का दिन में एक निशान।' },
      LECTURE_WISE: {
        en: 'One mark per student per period.',
        hi: 'हर विद्यार्थी का हर कालांश में एक निशान।',
      },
    }),
  },
  shifts: {
    title: { en: 'Shifts', hi: 'पालियाँ' },
    body: {
      en: 'The shifts your institute runs, such as morning and afternoon, with their times. They are saved with your settings and shown to the platform team; timetables, attendance and fees do not use them.',
      hi: 'आपके संस्थान की पालियाँ, जैसे सुबह और दोपहर, उनके समय के साथ। ये आपकी सेटिंग्स के साथ सहेजी जाती हैं और प्लेटफ़ॉर्म टीम को दिखती हैं; समय-सारणी, उपस्थिति और शुल्क इनका उपयोग नहीं करते।',
    },
  },
  gradingSystem: {
    title: { en: 'Grading system', hi: 'ग्रेडिंग प्रणाली' },
    body: {
      en: 'The grade bands recorded for your institute, shown here for reference. It cannot be changed on this page; contact support to change it. No other screen reads it.',
      hi: 'आपके संस्थान के लिए दर्ज ग्रेड बैंड, जो यहाँ केवल देखने के लिए दिखते हैं। इन्हें इस पेज पर नहीं बदला जा सकता; बदलने के लिए सहायता से संपर्क करें। कोई अन्य स्क्रीन इन्हें नहीं पढ़ती।',
    },
  },
  optimalStrength: {
    title: { en: 'Optimal strength', hi: 'आदर्श संख्या' },
    body: {
      en: 'The number of students a section is planned for. It is saved with your settings; no screen warns when a section reaches it. The hard maximum is what limits a section.',
      hi: 'एक अनुभाग में जितने विद्यार्थियों की योजना है। यह आपकी सेटिंग्स के साथ सहेजा जाता है; अनुभाग इस संख्या तक पहुँचने पर कोई स्क्रीन चेतावनी नहीं देती। अनुभाग की सीमा अधिकतम सीमा से तय होती है।',
    },
  },
  hardMax: {
    title: { en: 'Hard maximum', hi: 'अधिकतम सीमा' },
    body: {
      en: 'When a section has this many students, enrolling a student into it, or moving a student into it, needs a written reason. Year-end promotion also plans sections up to this number.',
      hi: 'जब किसी अनुभाग में इतने विद्यार्थी हों, तो उसमें विद्यार्थी का नामांकन करने या उसे उसमें भेजने के लिए लिखित कारण देना होता है। वर्ष के अंत की पदोन्नति भी अनुभागों की योजना इसी संख्या तक बनाती है।',
    },
  },
  exemptionAllowed: {
    title: { en: 'Allow exemptions', hi: 'छूट की अनुमति दें' },
    body: {
      en: 'Whether a full section may take more students when a reason is given. It is saved with your settings, but enrolment does not read it: a full section accepts a student with a reason either way.',
      hi: 'कारण देने पर भरा हुआ अनुभाग और विद्यार्थी ले सकता है या नहीं। यह आपकी सेटिंग्स के साथ सहेजा जाता है, पर नामांकन इसे नहीं पढ़ता: भरा हुआ अनुभाग दोनों स्थितियों में कारण देने पर विद्यार्थी ले लेता है।',
    },
  },
});
