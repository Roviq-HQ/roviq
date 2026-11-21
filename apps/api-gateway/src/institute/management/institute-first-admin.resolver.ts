import { UseGuards } from '@nestjs/common';
import { Parent, ResolveField, Resolver } from '@nestjs/graphql';
import { CurrentUser, GqlAuthGuard } from '@roviq/auth-backend';
import { type AuthUser, BusinessException, ErrorCode } from '@roviq/common-types';
import { IdentityService } from '../../auth/identity.service';
import { InstituteFirstAdminObject, InstituteModel } from './models/institute.model';

/** Indian numbers without +91, as the form takes them; others keep their country code. */
function formatPhone(phone: { countryCode: string; number: string }): string {
  return phone.countryCode === '+91' ? phone.number : `${phone.countryCode}${phone.number}`;
}

/**
 * `InstituteModel.firstAdmin` holds a person's email and phone, so it resolves only for the
 * platform and the reseller that owns the institute; every institute-scope caller (admin,
 * teacher, student, guardian) gets FORBIDDEN, whatever query returned the institute. A
 * reseller gets the name and phone only for an account its own staff created.
 */
@UseGuards(GqlAuthGuard)
@Resolver(() => InstituteModel)
export class InstituteFirstAdminFieldResolver {
  constructor(private readonly identity: IdentityService) {}

  @ResolveField(() => InstituteFirstAdminObject, {
    nullable: true,
    description:
      'The user named to become the institute admin when setup runs, as their account shows them now. Platform and the owning reseller only; null when none was named.',
  })
  async firstAdmin(
    @Parent() institute: { resellerId?: string | null; firstAdminUserId?: string | null },
    @CurrentUser() user: AuthUser,
  ): Promise<InstituteFirstAdminObject | null> {
    const ownsInstitute =
      user.scope === 'platform' ||
      (user.scope === 'reseller' && user.resellerId === institute.resellerId);
    if (!ownsInstitute) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        'The first admin is visible to the platform and the owning reseller only',
      );
    }
    if (!institute.firstAdminUserId) return null;
    const contact = await this.identity.findUserContact(institute.firstAdminUserId);
    if (!contact) return null;
    // Naming an email must not turn into a lookup of whoever owns it (SF-043): a reseller
    // reads the name and phone only of accounts its own staff created.
    if (
      user.scope === 'reseller' &&
      !(await this.identity.wasCreatedByReseller(contact.userId, user.resellerId))
    ) {
      return { email: contact.email, detailsWithheld: true };
    }
    return {
      detailsWithheld: false,
      // A reused account may have no profile; its Roviq ID is the only name it has.
      firstName: contact.firstName ?? contact.username,
      lastName: contact.lastName,
      email: contact.email,
      phone: contact.phone ? formatPhone(contact.phone) : null,
    };
  }
}
