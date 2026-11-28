import { headers } from 'next/headers';
import { Providers } from '../providers';

export default async function ResellerLayout({ children }: { children: React.ReactNode }) {
  // Set by the middleware with the page's content security policy. Reading it also makes the
  // page render per request, which a nonce needs.
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return (
    <Providers scope="reseller" nonce={nonce}>
      {children}
    </Providers>
  );
}
