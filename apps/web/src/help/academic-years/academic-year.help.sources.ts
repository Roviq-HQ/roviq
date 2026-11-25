import type { HelpSources } from '@roviq/ui';
import type { academicYearHelp } from './academic-year.help';

const PAGES = 'apps/web/src/app/[locale]/institute/(dashboard)/academic-years';
const YEAR = 'apps/api-gateway/src/institute/academic-year';
const REPO = `${YEAR}/repositories/academic-year.drizzle-repository.ts`;

export const academicYearHelpSources = {
  label: [
    `${PAGES}/create-year-dialog.tsx#buildSchema`,
    `${PAGES}/edit-year-sheet.tsx#buildSchema`,
    `${YEAR}/dto/create-academic-year.input.ts#CreateAcademicYearInput.label`,
    `${YEAR}/dto/update-academic-year.input.ts#UpdateAcademicYearInput.label`,
    `${YEAR}/academic-year.service.ts#AcademicYearService.validateLabelMatchesDates`,
    'apps/api-gateway/src/institute/certificate/export-file-name.ts#complianceExportFileName',
  ],
  startDate: [
    `${PAGES}/create-year-dialog.tsx#buildSchema`,
    `${PAGES}/edit-year-sheet.tsx#buildSchema`,
    `${YEAR}/academic-year.service.ts#OVERLAP_VALIDATED_INSTITUTE_TYPES`,
    `${YEAR}/academic-year.service.ts#AcademicYearService.validateNoOverlap`,
    `${REPO}#AcademicYearDrizzleRepository.findOverlapping`,
  ],
  endDate: [
    `${PAGES}/create-year-dialog.tsx#buildSchema`,
    `${PAGES}/edit-year-sheet.tsx#buildSchema`,
    `${YEAR}/academic-year.service.ts#AcademicYearService.create`,
    `${YEAR}/academic-year.service.ts#AcademicYearService.update`,
    `${YEAR}/academic-year.service.ts#OVERLAP_VALIDATED_INSTITUTE_TYPES`,
    `${YEAR}/academic-year.service.ts#AcademicYearService.validateNoOverlap`,
    `${REPO}#AcademicYearDrizzleRepository.findOverlapping`,
  ],
  termStructure: [
    `${PAGES}/create-year-dialog.tsx#buildSchema`,
    `${YEAR}/dto/create-academic-year.input.ts#CreateAcademicYearInput.termStructure`,
    `${REPO}#AcademicYearDrizzleRepository.create`,
  ],
} satisfies HelpSources<typeof academicYearHelp>;
