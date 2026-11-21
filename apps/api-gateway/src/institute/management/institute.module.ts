import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { FilesModule } from '../../files/files.module';
import { InstituteResolver } from './institute.resolver';
import { InstituteService } from './institute.service';
import { InstituteSubscriptionResolver } from './institute.subscription';
import { InstituteBrandingImageResolver } from './institute-branding-image.resolver';
import { InstituteFieldResolver } from './institute-field.resolver';
import { InstituteFirstAdminFieldResolver } from './institute-first-admin.resolver';
import { InstituteRepositoryModule } from './repositories/institute-repository.module';
import { InstituteSeederService } from './seed/institute-seeder.service';
import { InstituteSetupService } from './seed/institute-setup.service';

@Module({
  imports: [InstituteRepositoryModule, FilesModule, AuthModule],
  providers: [
    InstituteService,
    InstituteResolver,
    InstituteFieldResolver, // scope-agnostic @ResolveField handlers (branding/config/identifiers/affiliations)
    InstituteFirstAdminFieldResolver, // platform and owning reseller only
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
