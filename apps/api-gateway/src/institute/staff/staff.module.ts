import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { FilesModule } from '../../files/files.module';
import { SignInDetailsModule } from '../sign-in-details/sign-in-details.module';
import { StaffResolver } from './staff.resolver';
import { StaffService } from './staff.service';
import { StaffQualificationResolver } from './staff-qualification.resolver';
import { StaffQualificationService } from './staff-qualification.service';

@Module({
  imports: [AuthModule, FilesModule, SignInDetailsModule],
  providers: [StaffService, StaffResolver, StaffQualificationService, StaffQualificationResolver],
  exports: [StaffService, StaffQualificationService],
})
export class StaffModule {}
