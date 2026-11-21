import { BillingRealtime } from './billing-realtime';

export default function ResellerBillingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <BillingRealtime />
      {children}
    </>
  );
}
