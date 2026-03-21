import { Providers } from '../providers';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <Providers scope="platform">{children}</Providers>;
}
