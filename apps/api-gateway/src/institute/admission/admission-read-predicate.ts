import { caslToSqlWhere } from '@roviq/casl';
import type { AppAbility } from '@roviq/common-types';
import { admissionApplicationsLive, enquiriesLive } from '@roviq/database';

/** SQL form of the caller's read rules; join the matching live view into the query. */
export function admissionReadPredicate(ability: AppAbility, subject: 'Enquiry' | 'Application') {
  return subject === 'Enquiry'
    ? caslToSqlWhere(ability, 'read', subject, {
        id: enquiriesLive.id,
        tenantId: enquiriesLive.tenantId,
        assignedTo: enquiriesLive.assignedTo,
        createdBy: enquiriesLive.createdBy,
        academicYearId: enquiriesLive.academicYearId,
        status: enquiriesLive.status,
      })
    : caslToSqlWhere(ability, 'read', subject, {
        id: admissionApplicationsLive.id,
        tenantId: admissionApplicationsLive.tenantId,
        createdBy: admissionApplicationsLive.createdBy,
        academicYearId: admissionApplicationsLive.academicYearId,
        standardId: admissionApplicationsLive.standardId,
        sectionId: admissionApplicationsLive.sectionId,
        status: admissionApplicationsLive.status,
        enquiryId: admissionApplicationsLive.enquiryId,
        studentProfileId: admissionApplicationsLive.studentProfileId,
      });
}
