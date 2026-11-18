import { registerEnumType } from '@nestjs/graphql';
import { UserIdentifierType } from '@roviq/common-types';

registerEnumType(UserIdentifierType, {
  name: 'UserIdentifierType',
  description: 'Government-issued or institutional ID document type.',
});

export { UserIdentifierType };
