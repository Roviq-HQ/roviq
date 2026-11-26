import type { AttendanceType } from '@roviq/common-types';
import { defineFieldHelp, helpOptions } from '@roviq/ui';

export const instituteConfigHelp = defineFieldHelp('instituteSettings.config', {
  attendanceType: {
    title: { en: 'Attendance type', hi: 'अटेंडेंस का टाइप' },
    body: {
      en: 'How your institute records attendance: once a day, or once per period.',
      hi: 'आपका संस्थान अटेंडेंस कैसे लेता है: दिन में एक बार, या हर पीरियड में।',
    },
    points: [
      {
        en: 'It is saved with your settings and shown to the platform team.',
        hi: 'यह आपकी सेटिंग्स के साथ सेव होता है और प्लेटफ़ॉर्म टीम को दिखता है।',
      },
      {
        en: 'The attendance screens work the same way for either choice.',
        hi: 'अटेंडेंस की स्क्रीन दोनों चुनावों में एक जैसी चलती हैं।',
      },
    ],
    options: helpOptions<AttendanceType>({
      DAILY: { en: 'One mark per student per day.', hi: 'हर स्टूडेंट की दिन में एक अटेंडेंस।' },
      LECTURE_WISE: {
        en: 'One mark per student per period.',
        hi: 'हर स्टूडेंट की हर पीरियड में एक अटेंडेंस।',
      },
    }),
  },
  shifts: {
    title: { en: 'Shifts', hi: 'शिफ्ट' },
    body: {
      en: 'The shifts your institute runs, such as morning and afternoon, with their times.',
      hi: 'आपके संस्थान की शिफ्ट, जैसे सुबह और दोपहर, उनके समय के साथ।',
    },
    points: [
      {
        en: 'They are saved with your settings and shown to the platform team.',
        hi: 'ये आपकी सेटिंग्स के साथ सेव होती हैं और प्लेटफ़ॉर्म टीम को दिखती हैं।',
      },
      {
        en: 'Timetables, attendance and fees do not use them.',
        hi: 'टाइमटेबल, अटेंडेंस और फ़ीस इनका इस्तेमाल नहीं करते।',
      },
    ],
  },
  gradingSystem: {
    title: { en: 'Grading system', hi: 'ग्रेडिंग सिस्टम' },
    body: {
      en: 'The grade bands recorded for your institute, shown here for reference.',
      hi: 'आपके संस्थान के लिए दर्ज ग्रेड बैंड, जो यहाँ सिर्फ़ देखने के लिए हैं।',
    },
    points: [
      {
        en: 'It cannot be changed on this page; contact support to change it.',
        hi: 'इस पेज पर इन्हें बदला नहीं जा सकता; बदलवाने के लिए सपोर्ट से बात करें।',
      },
      {
        en: 'No other screen reads it.',
        hi: 'कोई और स्क्रीन इन्हें नहीं पढ़ती।',
      },
    ],
  },
  optimalStrength: {
    title: { en: 'Optimal strength', hi: 'तय स्ट्रेंथ' },
    body: {
      en: 'The number of students a section is planned for.',
      hi: 'एक सेक्शन में जितने स्टूडेंट रखने की योजना है।',
    },
    points: [
      {
        en: "When adding, admitting, importing, enrolling, moving or reinstating a student brings a section up to it, the section's class teacher gets a notification (the academic coordinators, when the section has none).",
        hi: 'जब किसी स्टूडेंट को जोड़ने, एडमिशन देने, इम्पोर्ट करने, एनरोल करने, भेजने या दोबारा एनरोल करने से सेक्शन इस संख्या तक पहुँचता है, तो सेक्शन के क्लास टीचर को नोटिफ़िकेशन मिलता है (क्लास टीचर न हो तो एकेडमिक कोऑर्डिनेटर को)।',
      },
      {
        en: 'It is sent again only after the section drops below and fills up again.',
        hi: 'यह दोबारा तभी आता है जब सेक्शन इससे नीचे जाकर फिर भरता है।',
      },
      {
        en: 'The hard maximum is what limits a section.',
        hi: 'सेक्शन की सीमा अधिकतम सीमा से तय होती है।',
      },
    ],
  },
  hardMax: {
    title: { en: 'Hard maximum', hi: 'अधिकतम सीमा' },
    body: {
      en: 'When a section has this many students, adding one more needs a written reason.',
      hi: 'जब किसी सेक्शन में इतने स्टूडेंट हो जाएँ, तो एक और जोड़ने के लिए लिखकर कारण देना होता है।',
    },
    points: [
      {
        en: 'This applies to enrolling a student into the section or moving a student into it.',
        hi: 'यह स्टूडेंट को सेक्शन में एनरोल करने या उसमें भेजने, दोनों पर लागू है।',
      },
      {
        en: 'Year-end promotion also plans sections up to this number.',
        hi: 'साल के आखिर का प्रमोशन भी सेक्शन इसी संख्या तक भरता है।',
      },
    ],
  },
  exemptionAllowed: {
    title: { en: 'Allow exemptions', hi: 'छूट की इजाज़त दें' },
    body: {
      en: 'Whether a full section may take more students when a reason is given.',
      hi: 'कारण देने पर भरा हुआ सेक्शन और स्टूडेंट ले सकता है या नहीं।',
    },
    points: [
      {
        en: 'It is saved with your settings, but enrolment does not read it.',
        hi: 'यह आपकी सेटिंग्स के साथ सेव होता है, पर एनरोलमेंट इसे नहीं पढ़ता।',
      },
      {
        en: 'A full section accepts a student with a reason either way.',
        hi: 'भरा हुआ सेक्शन दोनों हाल में कारण देने पर स्टूडेंट ले लेता है।',
      },
    ],
  },
});
