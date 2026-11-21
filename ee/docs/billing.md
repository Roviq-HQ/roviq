# Billing Module

Enterprise-only billing system for managing subscription plans, subscriptions, invoices, and payment gateway integrations.

## Architecture

```
ee/apps/api-gateway/src/billing/     # NestJS billing feature module
ee/libs/backend/payments/            # @roviq/ee-payments — provider-agnostic payment gateway lib
```

### Feature module (`ee/apps/api-gateway/src/billing/`)

| File | Purpose |
|------|---------|
| `billing.module.ts` | Wires the repositories, services, resolvers and webhook controllers; imports PaymentsModule |
| `reseller/*.service.ts` | Business logic per area: plans, subscriptions, invoices, payments, gateway configs, dashboard |
| `repositories/` | Drizzle queries through `withReseller()` / `withTenant()`; every read and write runs under RLS |
| `reseller/`, `institute/`, `admin/` resolvers | Code-first GraphQL resolvers per scope — thin, delegate to the services |
| `billing-subscriptions.resolver.ts` | GraphQL subscriptions (realtime), see "Realtime" below |
| `webhook/` | REST `POST /webhooks/razorpay/:resellerId` and `POST /webhooks/cashfree/:resellerId` — verify signatures, delegate to `PaymentService` |
| `dto/` | GraphQL input types with `class-validator` decorators |
| `models/` | GraphQL object types (code-first) |

### Payment gateway library (`ee/libs/backend/payments/`)

Provider-agnostic abstraction over Razorpay and Cashfree.

| File | Purpose |
|------|---------|
| `ports/payment-gateway.port.ts` | `PaymentGateway` interface — the contract all adapters implement |
| `adapters/razorpay.adapter.ts` | Razorpay implementation |
| `adapters/cashfree.adapter.ts` | Cashfree implementation |
| `factory/payment-gateway.factory.ts` | `PaymentGatewayFactory` — resolves the correct adapter by provider name or institute config |
| `payments.module.ts` | NestJS module exporting `PaymentGatewayFactory` |

## Data Model

### Tables (all in `subscription_plans`, `subscriptions`, `invoices`, `payment_gateway_configs`, `payment_events`)

- **SubscriptionPlan** — plan definitions (name, amount, currency, interval, feature limits, isActive)
- **Subscription** — links an institute to a plan; tracks status, provider IDs, billing periods
- **Invoice** — payment records tied to subscriptions; tracks amount, status, billing period
- **PaymentGatewayConfig** — one per institute, stores which provider (Razorpay/Cashfree) they use
- **PaymentEvent** — idempotent webhook event log; `providerEventId` unique constraint prevents duplicate processing

### RLS

All billing tables (except `subscription_plans`) have Row-Level Security:
- `tenant_isolation_*` policies scope reads/writes by `institute_id` using `app.current_tenant_id`
- `admin_platform_access_*` policies grant platform admins full access via `app.is_platform_admin`
- `subscription_plans` has no RLS — plans are platform-level, visible to all

## Subscription Lifecycle

```
[Plan Created] ──▶ assignPlanToInstitute
                         │
                    ┌─────┴──────┐
                    │ Free plan  │ Paid plan
                    │ (amount=0) │ (amount>0)
                    ▼            ▼
               ACTIVE      PENDING_PAYMENT ──webhook──▶ ACTIVE
                    │            │
                    ▼            ▼
               CANCELED    ┌──────────────┐
                           │  PAST_DUE    │◀── halted/past_due webhook
                           │  PAUSED      │◀── pause action or webhook
                           │  CANCELED    │◀── cancel action or webhook
                           │  COMPLETED   │◀── completed webhook
                           └──────────────┘
```

### Free plans (amount=0)
- No payment gateway interaction
- Subscription goes directly to ACTIVE
- No checkout URL returned
- Cancel sets CANCELED immediately (no proration)

### Paid plans
- Gateway creates a provider plan + provider subscription
- Returns a checkout URL for the institute to complete payment
- Provider webhooks drive status transitions (activated → ACTIVE, halted → PAST_DUE, etc.)
- Cancel at cycle end: records `canceledAt`, provider webhook sets CANCELED when period ends
- Cancel immediately: calls gateway cancel, sets CANCELED; provider handles proration/refunds

## Paying an invoice online

The institute's invoice page (`/billing/invoices/:id`) pays the balance through the reseller's default gateway.

1. **Pay online** calls `initiatePayment(invoiceId)`. Only `SENT`, `PARTIALLY_PAID` and `OVERDUE` invoices are payable (`PAID` answers `INVOICE_ALREADY_PAID`, others `INVOICE_NOT_PAYABLE`); another institute's invoice answers `INVOICE_NOT_FOUND`. The institute needs a phone number and email (`PAYER_CONTACT_MISSING`).
2. If the invoice already has a `PENDING` gateway payment, the order is looked up on **the gateway it was made on** (the row's `gatewayProvider`, not the reseller's current default):
   - open for the same amount: reopened, so repeated clicks leave one pending payment;
   - expired, re-priced, unknown to the current credentials (test → live keys), or its provider no longer configured: the row is marked `FAILED` and a new order is created;
   - paid: the captured payment is read from the gateway (`findPaidPayment`) and recorded on the spot; `INVOICE_ALREADY_PAID` only if the gateway has not exposed the payment yet.
3. The result carries `gatewayProvider` and `checkoutPayload`:
   - **Razorpay**: the page loads `checkout.razorpay.com/v1/checkout.js` and opens the modal. Its handler calls `verifyPayment({ gatewayOrderId, gatewayPaymentId, signature })`; the server checks the HMAC of `order_id|payment_id`. No `callback_url`, because it would bypass the handler.
   - **Cashfree**: the page loads the v3 JS SDK and redirects with `paymentSessionId`. Cashfree returns the payer to `<institute portal>/billing/invoices/:id?order_id=<order>` (origin of `BILLING_RETURN_URL`); the page calls `verifyPayment({ gatewayOrderId })`, retrying up to four times 3 s apart while the answer is `PAYMENT_VERIFICATION_FAILED`. The server reads the paid order from Cashfree; nothing from the browser is trusted.
4. Every order carries its invoice and institute (`notes` on Razorpay, `order_tags` on Cashfree); webhooks read them back as `owner`.
5. Settling is one transaction (`PaymentRepository.settleGatewayOrder`): the order's row, `PENDING` or `FAILED` and not yet captured, becomes `SUCCEEDED` and its amount is added to the invoice. Browser verify, the webhook and a reopened paid order can race; only the first settles, so the invoice is credited once. A `FAILED` row is settled too, because a payer can still pay an order that a newer one replaced.
6. Webhooks act only on captures (`payment.captured` on Razorpay, `PAYMENT_SUCCESS_WEBHOOK` with `SUCCESS` on Cashfree). A capture whose order has no row is recorded from `owner` with `recordGatewayPayment` (insert `ON CONFLICT DO NOTHING` on the unique `gateway_payment_id`, invoice update in the same transaction); without a matching invoice it is logged and acknowledged.

Errors reach the page as codes (`ErrorCode`) and are shown with copy from `instituteBilling.errors`, never the server message.

## Webhook Processing

1. `POST /webhooks/{razorpay|cashfree}` receives raw request
2. Controller verifies signature via `gateway.verifyWebhook()`
3. `billingService.processWebhookEvent()` atomically claims event (unique `providerEventId`)
4. Processes subscription status change + creates invoice on charge/capture
5. Marks event as processed only after handler succeeds (failed handlers leave events retryable)
6. Emits NATS event for downstream consumers

## Event Bus

All state changes emit NATS events via `ClientProxy`:
- `billing.plan.created`, `billing.plan.updated`
- `billing.subscription.created`, `.canceled`, `.paused`, `.resumed`
- `billing.webhook.{provider}`

## Realtime

GraphQL subscriptions in `billing-subscriptions.resolver.ts`. Each event carries ids only; the client refetches what it shows.

| Scope | Subscription | Fires on | Payload |
|-------|--------------|----------|---------|
| institute | `mySubscriptionStatusChanged` | any change to the institute's subscription | `subscriptionId`, `tenantId` |
| institute | `myInvoiceGenerated` | an invoice raised for the institute | `invoiceId`, `tenantId` |
| institute | `myPaymentStatusChanged` | any change to one of its payments | `paymentId`, `invoiceId`, `tenantId` |
| reseller | `resellerInvoiceGenerated` | an invoice raised for one of its institutes | `invoiceId`, `tenantId` |
| reseller | `resellerPaymentReceived` | money captured or recorded | `paymentId`, `invoiceId`, `tenantId` |
| reseller | `resellerPaymentStatusChanged` | every payment change, including a UPI proof waiting for verification | `paymentId`, `invoiceId`, `tenantId` |
| reseller | `resellerSubscriptionChanged` | any change to a subscription of one of its institutes | `subscriptionId`, `tenantId` |

Delivery is filtered on the `tenantId` / `resellerId` inside the event, so the event schemas in `event-schemas.ts` require both ids on `BILLING.subscription.status_changed`, `BILLING.payment.status_changed`, `BILLING.payment.succeeded` and `BILLING.invoice.generated`. An event without them is delivered to nobody.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `RAZORPAY_KEY_ID` | For Razorpay | API key ID |
| `RAZORPAY_KEY_SECRET` | For Razorpay | API key secret |
| `RAZORPAY_WEBHOOK_SECRET` | For Razorpay | Webhook signature verification |
| `CASHFREE_CLIENT_ID` | For Cashfree | Client ID |
| `CASHFREE_CLIENT_SECRET` | For Cashfree | Client secret |
| `CASHFREE_ENVIRONMENT` | For Cashfree | `SANDBOX` or `PRODUCTION` |
| `CASHFREE_API_VERSION` | For Cashfree | API version (e.g., `2025-01-01`) |
| `BILLING_RETURN_URL` | Yes (EE) | Institute portal URL that subscription checkout returns to (e.g., `http://localhost:4200/billing/subscriptions`). Its origin is also used for the Cashfree invoice return, `/billing/invoices/:id?order_id=…` |
| `ROVIQ_EE` | Yes | Set to `true` to load BillingModule |

## Testing

```bash
# Unit tests (no external services needed)
nx run api-gateway:test -- billing
nx run ee-payments:test

# E2E — Vitest against a running stack (Tilt or Docker `--profile e2e`)
pnpm test:e2e:api

# Teardown (Docker profile only)
pnpm e2e:down
```

**Unit tests** mock the repository, NATS client, and payment gateway factory. No DB or external services required.

**E2E tests** live in `e2e/api-gateway-e2e/src/billing.api-e2e.spec.ts` and run the full billing flow against a live gateway: login → create plan → assign to institute → subscription lifecycle (cancel, pause, resume). Paid subscriptions use simulated webhook payloads signed with sandbox gateway credentials.
