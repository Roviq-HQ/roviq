import { registerEnumType } from '@nestjs/graphql';
import { FormHelpMode } from '@roviq/common-types';

registerEnumType(FormHelpMode, {
  name: 'FormHelpMode',
  description:
    'How much field help forms show: ICON_AND_HINT adds a one-sentence hint under labels, ICON_ONLY shows only the help button.',
});

export { FormHelpMode };
