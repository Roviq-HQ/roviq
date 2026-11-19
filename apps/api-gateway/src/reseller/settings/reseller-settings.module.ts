import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { ResellerSettingsDrizzleRepository } from './repositories/reseller-settings.drizzle-repository';
import { ResellerSettingsRepository } from './repositories/reseller-settings.repository';
import { ResellerSettingsResolver } from './reseller-settings.resolver';
import { ResellerSettingsService } from './reseller-settings.service';

@Module({
  imports: [AuthModule],
  providers: [
    ResellerSettingsService,
    ResellerSettingsResolver,
    { provide: ResellerSettingsRepository, useClass: ResellerSettingsDrizzleRepository },
  ],
})
export class ResellerSettingsModule {}
