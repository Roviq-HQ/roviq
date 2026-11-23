import { UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { assertPlatformContext, CurrentUser, PlatformScope } from '@roviq/auth-backend';
import { AbilityGuard, CheckAbility } from '@roviq/casl';
import type { AuthUser } from '@roviq/common-types';
import { AdminMessagingService } from './admin-messaging.service';
import {
  RegisterMessagingSenderInput,
  RotateMessagingSenderTokenArgs,
  UpdateMessagingSenderInput,
  WhatsAppUsageArgs,
} from './dto/messaging-sender.dto';
import { AdminMessagingSender, AdminWhatsAppUsageRow } from './models/admin-messaging-sender.model';
import type { MessagingSenderRecord, WhatsAppUsageRecord } from './repositories/types';

@PlatformScope()
@Resolver(() => AdminMessagingSender)
export class AdminMessagingResolver {
  constructor(private readonly service: AdminMessagingService) {}

  @Query(() => [AdminMessagingSender], {
    description: "Every live WhatsApp sender, the platform's first.",
  })
  @UseGuards(AbilityGuard)
  @CheckAbility({ action: 'read', subject: 'MessagingSender' })
  adminMessagingSenders(@CurrentUser() user: AuthUser): Promise<MessagingSenderRecord[]> {
    assertPlatformContext(user);
    return this.service.list(user);
  }

  @Mutation(() => AdminMessagingSender, {
    description:
      "Registers the platform's WhatsApp sender, or an institute's own, with its access token. One live sender per institute (and one for the platform); a provider number is registered once.",
  })
  @UseGuards(AbilityGuard)
  @CheckAbility({ action: 'create', subject: 'MessagingSender' })
  adminRegisterMessagingSender(
    @CurrentUser() user: AuthUser,
    @Args('input') input: RegisterMessagingSenderInput,
  ): Promise<MessagingSenderRecord> {
    assertPlatformContext(user);
    return this.service.register(user, input);
  }

  @Mutation(() => AdminMessagingSender, { description: 'Changes the number shown or the caps.' })
  @UseGuards(AbilityGuard)
  @CheckAbility({ action: 'update', subject: 'MessagingSender' })
  adminUpdateMessagingSender(
    @CurrentUser() user: AuthUser,
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: UpdateMessagingSenderInput,
  ): Promise<MessagingSenderRecord> {
    assertPlatformContext(user);
    return this.service.update(user, id, input);
  }

  @Mutation(() => AdminMessagingSender, {
    description: "Replaces the sender's access token. The old token stops being used at once.",
  })
  @UseGuards(AbilityGuard)
  @CheckAbility({ action: 'update', subject: 'MessagingSender' })
  adminRotateMessagingSenderToken(
    @CurrentUser() user: AuthUser,
    @Args() args: RotateMessagingSenderTokenArgs,
  ): Promise<MessagingSenderRecord> {
    assertPlatformContext(user);
    return this.service.rotateToken(user, args.id, args.accessToken);
  }

  @Mutation(() => AdminMessagingSender, { description: 'ACTIVE → PAUSED: nothing is sent.' })
  @UseGuards(AbilityGuard)
  @CheckAbility({ action: 'update', subject: 'MessagingSender' })
  adminPauseMessagingSender(
    @CurrentUser() user: AuthUser,
    @Args('id', { type: () => ID }) id: string,
  ): Promise<MessagingSenderRecord> {
    assertPlatformContext(user);
    return this.service.pause(user, id);
  }

  @Mutation(() => AdminMessagingSender, {
    description: 'PAUSED or BLOCKED → ACTIVE: the sender sends again.',
  })
  @UseGuards(AbilityGuard)
  @CheckAbility({ action: 'update', subject: 'MessagingSender' })
  adminActivateMessagingSender(
    @CurrentUser() user: AuthUser,
    @Args('id', { type: () => ID }) id: string,
  ): Promise<MessagingSenderRecord> {
    assertPlatformContext(user);
    return this.service.activate(user, id);
  }

  @Mutation(() => AdminMessagingSender, {
    description: 'ACTIVE or PAUSED → BLOCKED: the provider restricted the number.',
  })
  @UseGuards(AbilityGuard)
  @CheckAbility({ action: 'update', subject: 'MessagingSender' })
  adminBlockMessagingSender(
    @CurrentUser() user: AuthUser,
    @Args('id', { type: () => ID }) id: string,
  ): Promise<MessagingSenderRecord> {
    assertPlatformContext(user);
    return this.service.block(user, id);
  }

  @Mutation(() => Boolean, {
    description:
      'Deletes the sender and its access token. Its institute (or the platform) may then register a new one.',
  })
  @UseGuards(AbilityGuard)
  @CheckAbility({ action: 'delete', subject: 'MessagingSender' })
  async adminDeleteMessagingSender(
    @CurrentUser() user: AuthUser,
    @Args('id', { type: () => ID }) id: string,
  ): Promise<boolean> {
    assertPlatformContext(user);
    await this.service.delete(user, id);
    return true;
  }

  @Query(() => [AdminWhatsAppUsageRow], {
    description:
      'WhatsApp messages the provider accepted (status SENT) in one calendar month, counted in India time (Asia/Kolkata), one row per institute and template category.',
  })
  @UseGuards(AbilityGuard)
  @CheckAbility({ action: 'read', subject: 'MessagingSender' })
  adminWhatsAppUsage(
    @CurrentUser() user: AuthUser,
    @Args() args: WhatsAppUsageArgs,
  ): Promise<WhatsAppUsageRecord[]> {
    assertPlatformContext(user);
    return this.service.whatsAppUsage(user, args.month);
  }
}
