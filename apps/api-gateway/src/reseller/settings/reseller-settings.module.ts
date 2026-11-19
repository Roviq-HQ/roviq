import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { FilesModule } from '../../files/files.module';
import { ResellerFileResolver } from '../file/reseller-file.resolver';
import { ResellerSettingsDrizzleRepository } from './repositories/reseller-settings.drizzle-repository';
import { ResellerSettingsRepository } from './repositories/reseller-settings.repository';
import { ResellerSettingsResolver } from './reseller-settings.resolver';
import { ResellerSettingsService } from './reseller-settings.service';

@Module({
  imports: [AuthModule, FilesModule],
  providers: [
    ResellerSettingsService,
    ResellerSettingsResolver,
    ResellerFileResolver,
    { provide: ResellerSettingsRepository, useClass: ResellerSettingsDrizzleRepository },
  ],
})
export class ResellerSettingsModule {}
