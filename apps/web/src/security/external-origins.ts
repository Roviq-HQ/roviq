// Third-party services the browser itself calls. A call site takes its address from here, and
// so does the content security policy: an address typed anywhere else is blocked by the browser.

/** India Post PIN code directory: fills city, district and state from a 6-digit PIN. */
export const PIN_CODE_LOOKUP_URL = 'https://api.postalpincode.in/pincode';

export const EXTERNAL_CONNECT_ORIGINS: readonly string[] = [new URL(PIN_CODE_LOOKUP_URL).origin];
