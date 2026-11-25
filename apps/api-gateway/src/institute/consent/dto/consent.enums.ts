import { registerEnumType } from '@nestjs/graphql';
import { ConsentPurpose, ConsentVerificationMethod } from '@roviq/common-types';

registerEnumType(ConsentPurpose, {
  name: 'ConsentPurpose',
  description: 'What a guardian consents to; each purpose needs its own consent (DPDP Section 6).',
});

registerEnumType(ConsentVerificationMethod, {
  name: 'ConsentVerificationMethod',
  description: "How the guardian's identity was checked for a consent action.",
});

export { ConsentPurpose, ConsentVerificationMethod };
