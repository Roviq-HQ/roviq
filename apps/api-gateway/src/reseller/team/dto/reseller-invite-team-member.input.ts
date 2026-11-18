import { Field, ID, InputType } from '@nestjs/graphql';
import { IsEmail, IsUUID, MaxLength } from 'class-validator';

@InputType({ description: 'Add a person to the reseller team by email' })
export class ResellerInviteTeamMemberInput {
  @Field({
    description:
      'An existing account with this email is added to the team; otherwise a new account is created with the email as its Roviq ID and a temporary password is sent.',
  })
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @Field(() => ID, {
    description:
      "One of this reseller's roles, not senior to the caller's own role or to the reseller's tier.",
  })
  @IsUUID()
  roleId!: string;
}
