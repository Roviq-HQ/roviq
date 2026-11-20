import { Module } from '@nestjs/common';
import { FilesModule } from '../../files/files.module';
import { InstituteResolver } from './institute.resolver';
import { InstituteService } from './institute.service';
import { InstituteSubscriptionResolver } from './institute.subscription';
import { InstituteBrandingImageResolver } from './institute-branding-image.resolver';
import { InstituteFieldResolver } from './institute-field.resolver';
import { InstituteRepositoryModule } from './repositories/institute-repository.module';
import { InstituteSeederService } from './seed/institute-seeder.service';
import { InstituteSetupService } from './seed/institute-setup.service';

@Module({
  imports: [InstituteRepositoryModule, FilesModule],
  providers: [
    InstituteService,
    InstituteResolver,
    InstituteFieldResolver, // scope-agnostic @ResolveField handlers (branding/config/identifiers/affiliations)
    InstituteSubscriptionResolver,
    InstituteBrandingImageResolver,
    InstituteSeederService,
    InstituteSetupService,
  ],
  exports: [
    InstituteService,
    InstituteSeederService,
    InstituteSetupService,
    InstituteRepositoryModule,
  ],
})
export class InstituteModule {}
