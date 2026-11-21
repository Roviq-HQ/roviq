import { Module } from '@nestjs/common';
import { InstituteModule } from '../management/institute.module';
import { InstituteSetupWorkerService } from './institute-setup.worker';

/** Runs the institute setup workflow that the admin approval flow starts. */
@Module({ imports: [InstituteModule], providers: [InstituteSetupWorkerService] })
export class InstituteSetupModule {}
