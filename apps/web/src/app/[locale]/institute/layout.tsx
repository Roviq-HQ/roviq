import { Providers } from '../providers';

export default function InstituteLayout({ children }: { children: React.ReactNode }) {
  return <Providers scope="institute">{children}</Providers>;
}
