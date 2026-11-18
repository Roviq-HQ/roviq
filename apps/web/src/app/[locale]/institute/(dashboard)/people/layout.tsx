import { PersonDetailDialogProvider } from './person-detail-dialog';

export default function PeopleLayout({ children }: { children: React.ReactNode }) {
  return <PersonDetailDialogProvider>{children}</PersonDetailDialogProvider>;
}
