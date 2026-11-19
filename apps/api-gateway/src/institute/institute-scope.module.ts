import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AcademicYearModule } from './academic-year/academic-year.module';
import { AdmissionModule } from './admission/admission.module';
import { AttendanceModule } from './attendance/attendance.module';
import { InstituteAuditResolver } from './audit/institute-audit.resolver';
import { BotModule } from './bot/bot.module';
import { CertificateModule } from './certificate/certificate.module';
import { ConsentModule } from './consent/consent.module';
import { ExaminationModule } from './examination/examination.module';
import { InstituteFileModule } from './file/institute-file.module';
import { GroupModule } from './group/group.module';
import { GuardianModule } from './guardian/guardian.module';
import { HolidayModule } from './holiday/holiday.module';
import { InstituteImpersonationModule } from './impersonation/institute-impersonation.module';
import { InstituteGroupModule } from './institute-group/institute-group.module';
import { LeaveModule } from './leave/leave.module';
import { InstituteModule } from './management/institute.module';
import { NotificationConfigModule } from './notification-config/notification-config.module';
import { SectionModule } from './section/section.module';
import { StaffModule } from './staff/staff.module';
import { StandardModule } from './standard/standard.module';
import { StudentModule } from './student/student.module';
import { SubjectModule } from './subject/subject.module';
import { TimetableModule } from './timetable/timetable.module';
import { ProfileModule } from './user/profile.module';

@Module({
  imports: [
    AuditModule,
    AcademicYearModule,
    AdmissionModule,
    AttendanceModule,
    BotModule,
    CertificateModule,
    ConsentModule,
    ExaminationModule,
    InstituteFileModule,
    GroupModule,
    GuardianModule,
    HolidayModule,
    InstituteImpersonationModule,
    InstituteModule,
    InstituteGroupModule,
    LeaveModule,
    NotificationConfigModule,
    ProfileModule,
    SectionModule,
    StaffModule,
    StandardModule,
    StudentModule,
    SubjectModule,
    TimetableModule,
  ],
  providers: [InstituteAuditResolver],
})
export class InstituteScopeModule {}
