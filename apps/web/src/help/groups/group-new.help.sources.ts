import type { HelpSources } from '@roviq/ui';
import type { groupNewHelp } from './group-new.help';

export const groupNewHelpSources = {
  type: [
    'apps/api-gateway/src/institute/group/dto/create-group.input.ts#UpdateGroupInput',
    'apps/api-gateway/src/institute/group/group.service.ts#GroupService.resolveMembers',
    'apps/web/src/app/[locale]/institute/(dashboard)/groups/page.tsx#GROUP_TYPE_ICON',
  ],
  membershipType: [
    'apps/api-gateway/src/institute/group/dto/create-group.input.ts#UpdateGroupInput',
    'apps/api-gateway/src/institute/group/group.service.ts#GroupService.resolveMembers',
  ],
  memberTypes: [
    'apps/api-gateway/src/institute/group/dto/create-group.input.ts#UpdateGroupInput',
    'apps/api-gateway/src/institute/group/group.service.ts#GroupService.create',
  ],
} satisfies HelpSources<typeof groupNewHelp>;
