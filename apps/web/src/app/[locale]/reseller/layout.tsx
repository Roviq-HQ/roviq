import { Providers } from '../providers';

export default function ResellerLayout({ children }: { children: React.ReactNode }) {
  return <Providers scope="reseller">{children}</Providers>;
}
