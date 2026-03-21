import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: {
    default: 'Roviq',
    template: '%s | Roviq',
  },
  description: 'Roviq — multi-tenant institute management platform',
  icons: { icon: '/favicon.ico' },
  openGraph: {
    type: 'website',
    siteName: 'Roviq',
    title: 'Roviq',
    description: 'Roviq — multi-tenant institute management platform',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return children;
}
