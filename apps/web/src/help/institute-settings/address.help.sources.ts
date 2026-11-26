import type { HelpSources } from '@roviq/ui';
import type { addressHelp } from './address.help';

const FORM =
  'apps/web/src/app/[locale]/institute/(dashboard)/settings/institute/components/address-form.tsx#AddressForm';

export const addressHelpSources = {
  stateFiltered: [FORM],
  postalCode: [FORM],
  coordinates: [FORM],
} satisfies HelpSources<typeof addressHelp>;
