# Institutes: API reference

Every GraphQL operation, event and error code of the institute domain. The model and the lifecycles are in [institutes.md](institutes.md).

## Platform Scope (Admin)

### Mutations

| Mutation | CASL | Input | Returns |
|----------|------|-------|---------|
| `adminCreateInstitute(input)` | `create:Institute` | `AdminCreateInstituteInput` | `InstituteModel` |
| `adminApproveInstitute(id)` | `approve:Institute` | ID | `InstituteModel` |
| `adminActivateInstitute(id)` | `activate:Institute` | ID | `InstituteModel` |
| `adminRejectInstitute(id, reason)` | `reject:Institute` | ID + String | `InstituteModel` |
| `adminDeactivateInstitute(id)` | `deactivate:Institute` | ID | `InstituteModel` |
| `adminSuspendInstitute(id, reason?)` | `suspend:Institute` | ID + String? | `InstituteModel` |
| `adminDeleteInstitute(id)` | `delete:Institute` | ID | `Boolean` |
| `adminRestoreInstitute(id)` | `restore:Institute` | ID | `InstituteModel` |
| `adminCreateInstituteGroup(input)` | `create:InstituteGroup` | `CreateInstituteGroupInput` | `InstituteGroupModel` |
| `adminUpdateInstituteGroup(id, input)` | `update:InstituteGroup` | ID + `UpdateInstituteGroupInput` | `InstituteGroupModel` |
| `adminDeleteInstituteGroup(id)` | `delete:InstituteGroup` | ID | `Boolean` |
| `adminActivateInstituteGroup(id)` / `adminDeactivateInstituteGroup(id)` / `adminSuspendInstituteGroup(id)` | `update:InstituteGroup` | ID | `InstituteGroupModel` |
| `adminAddInstituteToGroup(instituteId, groupId)` / `adminRemoveInstituteFromGroup(instituteId)` | `manage:InstituteGroup` | IDs | `Boolean` |
| `adminAddInstituteGroupMember(groupId, userId, roleId)` | `manage:InstituteGroup` | IDs | `GroupMembershipModel` |
| `adminRemoveInstituteGroupMember(groupId, userId)` | `manage:InstituteGroup` | IDs | `Boolean` |

### Queries

| Query | CASL | Returns |
|-------|------|---------|
| `adminListInstitutes(filter?)` | `read:Institute` | `InstituteConnection` |
| `adminGetInstitute(id)` | `read:Institute` | `InstituteModel` |
| `adminInstituteStatistics` | `view_statistics:Institute` | `JSON` |
| `adminListInstituteGroups(filter?)` | `read:InstituteGroup` | `InstituteGroupConnection` |

### Subscriptions

| Subscription | Filter |
|-------------|--------|
| `adminInstituteApprovalRequested` | None (all events) |
| `adminInstituteCreated` | None (all events) |

---

## Reseller Scope

### Mutations

| Mutation | CASL | Tier | Returns |
|----------|------|------|---------|
| `resellerCreateInstituteRequest(input)` | `create:Institute` | full_management | `InstituteModel` |
| `resellerSuspendInstitute(id, reason?)` | `suspend:Institute` | full_management | `InstituteModel` |
| `resellerReactivateInstitute(id)` | `activate:Institute` | full_management | `InstituteModel` |
| `resellerCreateInstituteGroup(input)` | `create:InstituteGroup` | full_management | `InstituteGroupModel` (owned by the caller's reseller) |
| `resellerAddInstituteToGroup(instituteId, groupId)` / `resellerRemoveInstituteFromGroup(instituteId)` | `manage:InstituteGroup` | full_management | `Boolean` — own institutes into own groups only |

### Queries

| Query | CASL | Returns |
|-------|------|---------|
| `resellerListInstitutes(filter?)` | `read:Institute` | `InstituteConnection` |
| `resellerGetInstitute(id)` | `read:Institute` | `InstituteModel` |
| `resellerInstituteStatistics` | `view_statistics:Institute` | `JSON` |
| `resellerListInstituteGroups` | `read:InstituteGroup` | `InstituteGroupConnection` — groups the reseller owns or that contain its institutes; `instituteCount` counts only its own |

### Subscriptions

| Subscription | Filter |
|-------------|--------|
| `resellerInstituteCreated` | `resellerId` from JWT |
| `resellerInstituteStatusChanged` | `resellerId` from JWT |

---

## Institute Scope

Every operation here acts on the caller's own institute (the tenant in the token). Institute lifecycle and institute-group management are platform or reseller operations and are not exposed in this scope (ROV-290).

### Mutations

| Mutation | CASL | Returns |
|----------|------|---------|
| `updateInstituteInfo(input)` | `update_info:Institute` | `InstituteModel` |
| `updateInstituteBranding(input)` | `update_branding:Institute` | `InstituteModel` |
| `updateInstituteConfig(input)` | `update_config:Institute` | `InstituteModel` |
| `createAcademicYear(input)` | `create:AcademicYear` | `AcademicYearModel` |
| `updateAcademicYear(id, input)` | `update:AcademicYear` | `AcademicYearModel` |
| `activateAcademicYear(id)` | `activate:AcademicYear` | `AcademicYearModel` |
| `archiveAcademicYear(id)` | `archive:AcademicYear` | `AcademicYearModel` |
| `createStandard(input)` | `create:Standard` | `StandardModel` |
| `updateStandard(id, input)` | `update:Standard` | `StandardModel` |
| `deleteStandard(id)` | `delete:Standard` | `Boolean` |
| `createSection(input)` | `create:Section` | `SectionModel` |
| `updateSection(id, input)` | `update:Section` | `SectionModel` |
| `deleteSection(id)` | `delete:Section` | `Boolean` |
| `assignClassTeacher(sectionId, classTeacherId)` | `update:Section` | `SectionModel` |
| `createSubject(input)` | `create:Subject` | `SubjectModel` |
| `updateSubject(id, input)` | `update:Subject` | `SubjectModel` |
| `deleteSubject(id)` | `delete:Subject` | `Boolean` |
| `assignSubjectToStandard(subjectId, standardId)` | `update:Subject` | `Boolean` |
| `assignSubjectToSection(subjectId, sectionId)` | `update:Subject` | `Boolean` |
| `removeSubjectFromStandard(subjectId, standardId)` | `update:Subject` | `Boolean` |
| `removeSubjectFromSection(subjectId, sectionId)` | `update:Subject` | `Boolean` |

Every id these mutations take is read under the caller's institute in the write transaction, and a missing row refuses the request before anything is written or emitted:

- `createStandard`: the academic year (`ACADEMIC_YEAR_NOT_FOUND`).
- `createSection`: the standard (`STANDARD_NOT_FOUND`), the academic year (`ACADEMIC_YEAR_NOT_FOUND`), that the standard belongs to that year (`STANDARD_NOT_FOUND`), then the class teacher's membership (`MEMBERSHIP_NOT_FOUND`).
- `updateSection`, `assignClassTeacher`: the section (`SECTION_NOT_FOUND`), then the class teacher's membership.
- `createSubject`: each standard and section it names (`STANDARD_NOT_FOUND`, `SECTION_NOT_FOUND`).
- The four subject link mutations: the subject (`SUBJECT_NOT_FOUND`), then the standard or section.

### Queries

| Query | CASL | Returns |
|-------|------|---------|
| `myInstitute` | `read:Institute` | `InstituteModel` (with branding/config/identifiers/affiliations via @ResolveField) |
| `myInstituteGroup` | `read:InstituteGroup` | `InstituteGroupModel?` — the group the caller's institute belongs to |
| `academicYears` | `read:AcademicYear` | `[AcademicYearModel]` |
| `activeAcademicYear` | `read:AcademicYear` | `AcademicYearModel?` |
| `standards(academicYearId)` | `read:Standard` | `[StandardModel]` |
| `standard(id)` | `read:Standard` | `StandardModel` |
| `sections(standardId)` | `read:Section` | `[SectionModel]` |
| `section(id)` | `read:Section` | `SectionModel` |
| `subjects` | `read:Subject` | `[SubjectModel]` |
| `subject(id)` | `read:Subject` | `SubjectModel` |
| `subjectsByStandard(standardId)` | `read:Subject` | `[SubjectModel]` |

### Subscriptions

| Subscription | Filter |
|-------------|--------|
| `instituteUpdated` | `tenantId` from JWT |
| `instituteBrandingUpdated` | `tenantId` from JWT |
| `instituteConfigUpdated` | `tenantId` from JWT |
| `instituteSetupProgress` | `tenantId` from JWT |

---

## NATS Events

| Event | Payload | Published By |
|-------|---------|-------------|
| `INSTITUTE.created` | `{ instituteId, type }` | adminCreateInstitute |
| `INSTITUTE.approval_requested` | `{ instituteId, resellerId, requestedBy }` | resellerCreateInstituteRequest |
| `INSTITUTE.approved` | `{ instituteId, resellerId }` | adminApproveInstitute |
| `INSTITUTE.rejected` | `{ instituteId, resellerId, reason }` | adminRejectInstitute |
| `INSTITUTE.activated` | `{ instituteId, previousStatus }` | activate |
| `INSTITUTE.suspended` | `{ instituteId, reason, scope }` | suspend |
| `INSTITUTE.deactivated` | `{ instituteId, previousStatus }` | deactivate |
| `INSTITUTE.deleted` | `{ instituteId }` | delete |
| `INSTITUTE.restored` | `{ instituteId }` | restore |
| `INSTITUTE.branding_updated` | `{ instituteId, branding }` | updateBranding |
| `INSTITUTE.config_updated` | `{ instituteId, changedFields }` | updateConfig |
| `INSTITUTE.status_changed` | `{ instituteId, resellerId, previousStatus, newStatus }` | approve/reject |
| `INSTITUTE.setup_completed` | `{ instituteId }` | Temporal workflow |
| `INSTITUTE.setup_progress` | `{ instituteId, step, status, completedSteps, totalSteps }` | Temporal workflow |
| `ACADEMIC_YEAR.created` | `{ academicYearId, tenantId, label }` | createAcademicYear |
| `ACADEMIC_YEAR.activated` | `{ academicYearId, tenantId, previousYearId }` | activateAcademicYear |
| `ACADEMIC_YEAR.archived` | `{ academicYearId, tenantId }` | archiveAcademicYear |
| `STANDARD.created` | `{ standardId, tenantId, name }` | createStandard |
| `STANDARD.updated` | `{ standardId, tenantId }` | updateStandard |
| `STANDARD.deleted` | `{ standardId }` | deleteStandard |
| `SECTION.created` | `{ sectionId, tenantId, standardId }` | createSection |
| `SECTION.updated` | `{ sectionId, tenantId }` | updateSection |
| `SECTION.deleted` | `{ sectionId }` | deleteSection |
| `SECTION.teacher_assigned` | `{ sectionId, tenantId, classTeacherId }` | assignClassTeacher |
| `SUBJECT.created` | `{ subjectId, tenantId, name }` | createSubject |
| `SUBJECT.deleted` | `{ subjectId }` | deleteSubject |
| `SUBJECT.assigned_to_standard` | `{ subjectId, standardId }` | assignSubjectToStandard |
| `SUBJECT.assigned_to_section` | `{ subjectId, sectionId }` | assignSubjectToSection |
| `SUBJECT.removed_from_standard` | `{ subjectId, standardId }` | removeSubjectFromStandard |
| `SUBJECT.removed_from_section` | `{ subjectId, sectionId }` | removeSubjectFromSection |

---

## Error Codes

| Code | HTTP | When |
|------|------|------|
| `FORBIDDEN` | 403 | CASL permission denied |
| `INSTITUTE_NOT_FOUND` | 404 | Institute not found or soft-deleted |
| `INSTITUTE_CODE_DUPLICATE` | 409 | Code already used by another non-deleted institute |
| `SETUP_NOT_COMPLETE` | 422 | Cannot activate before setup_status=completed |
| `RESELLER_INVALID` | 422 | Reseller not found or inactive |
| `SYSTEM_RESELLER_PROTECTED` | 422 | Cannot modify "Roviq Direct" |
| `CONCURRENT_MODIFICATION` | 409 | Version mismatch on update |
| `ACADEMIC_YEAR_OVERLAP` | 400 | Date range overlaps (`SCHOOL` institutes only) |
| `INVALID_DATE_RANGE` | 400 | Start date >= end date |
| `LAST_ACADEMIC_YEAR` | 422 | Cannot delete last year |
| `YEAR_ALREADY_ACTIVE` | 409 | Year is already active |
| `ACADEMIC_YEAR_LABEL_DUPLICATE` | 409 | Label used by another year of the institute, deleted ones included |
| `STANDARD_NAME_DUPLICATE` | 409 | Name exists in same academic year |
| `STANDARD_ORDER_DUPLICATE` | 409 | Numeric order exists in same academic year |
| `SECTION_NAME_DUPLICATE` | 409 | Name exists in same standard |
| `HAS_ACTIVE_ENROLLMENTS` | 422 | Cannot delete with enrolled students |
| `HAS_RECORDED_ASSESSMENTS` | 422 | Cannot delete subject with assessments |
| `STREAM_REQUIRED` | 400 | Senior secondary section needs stream |
| `SECTION_CAPACITY_EXCEEDED` | 422 | Section at/over capacity |
