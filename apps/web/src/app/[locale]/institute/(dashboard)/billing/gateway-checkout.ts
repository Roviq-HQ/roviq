/** Browser checkout for the reseller's payment gateway (Razorpay modal or Cashfree redirect). */

const RAZORPAY_SCRIPT = 'https://checkout.razorpay.com/v1/checkout.js';
const CASHFREE_SCRIPT = 'https://sdk.cashfree.com/js/v3/cashfree.js';

/** What Razorpay Checkout hands to `handler` after a successful payment. */
export interface RazorpayPaymentResult {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
}

interface RazorpayCheckout {
  open(): void;
}

interface RazorpayOptions extends Record<string, unknown> {
  handler: (result: RazorpayPaymentResult) => void;
  modal: { ondismiss: () => void };
}

interface CashfreeInstance {
  checkout(options: { paymentSessionId: string; redirectTarget: '_self' }): Promise<unknown>;
}

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => RazorpayCheckout;
    Cashfree?: (options: { mode: 'sandbox' | 'production' }) => CashfreeInstance;
  }
}

/** Raised when the gateway's script cannot be loaded or its checkout options are unusable. */
export class CheckoutUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CheckoutUnavailableError';
  }
}

const loading = new Map<string, Promise<void>>();

function loadScript(src: string): Promise<void> {
  const known = loading.get(src);
  if (known) return known;
  const promise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      loading.delete(src);
      script.remove();
      reject(new CheckoutUnavailableError(`Could not load ${src}`));
    };
    document.body.appendChild(script);
  });
  loading.set(src, promise);
  return promise;
}

/**
 * Opens the Razorpay modal. Resolves with the signed result once the payment succeeds,
 * or with null when the payer closes the modal.
 */
export async function openRazorpayCheckout(
  payload: Record<string, unknown>,
  extra: { name: string; description?: string },
): Promise<RazorpayPaymentResult | null> {
  if (typeof payload.key !== 'string' || typeof payload.order_id !== 'string') {
    throw new CheckoutUnavailableError('Razorpay checkout options are incomplete');
  }
  await loadScript(RAZORPAY_SCRIPT);
  const Razorpay = window.Razorpay;
  if (!Razorpay) throw new CheckoutUnavailableError('Razorpay Checkout did not load');

  return new Promise((resolve) => {
    const checkout = new Razorpay({
      ...payload,
      ...extra,
      handler: (result) => resolve(result),
      modal: { ondismiss: () => resolve(null) },
    });
    checkout.open();
  });
}

/** Sends the payer to Cashfree; they come back to the invoice page with `?order_id=`. */
export async function redirectToCashfreeCheckout(payload: Record<string, unknown>) {
  const { paymentSessionId, mode } = payload;
  if (typeof paymentSessionId !== 'string' || (mode !== 'sandbox' && mode !== 'production')) {
    throw new CheckoutUnavailableError('Cashfree checkout options are incomplete');
  }
  await loadScript(CASHFREE_SCRIPT);
  const Cashfree = window.Cashfree;
  if (!Cashfree) throw new CheckoutUnavailableError('Cashfree SDK did not load');
  await Cashfree({ mode }).checkout({ paymentSessionId, redirectTarget: '_self' });
}
