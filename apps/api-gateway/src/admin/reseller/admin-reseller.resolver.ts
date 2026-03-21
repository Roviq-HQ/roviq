import { Args, Mutation, Resolver } from '@nestjs/graphql';
import { PlatformScope } from '@roviq/auth-backend';
import { AdminResellerService } from './admin-reseller.service';

@PlatformScope()
@Resolver()
export class AdminResellerResolver {
  constructor(private readonly resellerService: AdminResellerService) {}

  @Mutation(() => Boolean, {
    description: 'Suspend a reseller and revoke all staff sessions',
  })
  async adminSuspendReseller(@Args('resellerId') resellerId: string): Promise<boolean> {
    await this.resellerService.suspendReseller(resellerId);
    return true;
  }

  @Mutation(() => Boolean, {
    description: 'Delete a suspended reseller after 30-day grace period',
  })
  async adminDeleteReseller(@Args('resellerId') resellerId: string): Promise<boolean> {
    await this.resellerService.deleteReseller(resellerId);
    return true;
  }
}
