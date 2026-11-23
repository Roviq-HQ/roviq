import { registerEnumType } from '@nestjs/graphql';
import { SignInStatus } from '@roviq/common-types';

registerEnumType(SignInStatus, {
  name: 'SignInStatus',
  description: 'Where a staff member or guardian stands with their first sign-in.',
  valuesMap: {
    SIGNED_IN: { description: 'Signed in and set their own password' },
    DETAILS_SENT: { description: 'The latest sign-in details reached the email or SMS provider' },
    SEND_FAILED: { description: 'The latest send failed' },
    NOT_SENT_NO_CONTACT: { description: 'Nothing sent: no real email and no phone' },
    NOT_SENT: { description: 'Nothing sent yet' },
  },
});

export { SignInStatus };
