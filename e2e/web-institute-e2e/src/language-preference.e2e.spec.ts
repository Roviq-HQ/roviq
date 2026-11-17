import path from 'node:path';
import { test } from '../../shared/console-guardian';
import { languagePreferenceTests } from '../../shared/language-preference-tests';

test.use({ storageState: path.join(__dirname, '../../playwright/.auth/institute-teacher.json') });

languagePreferenceTests('institute');
