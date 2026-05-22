import { registerEnumType } from '@nestjs/graphql';
import {
  BillingInterval,
  GatewayConfigStatus,
  InvoiceStatus,
  PaymentMethod,
  PaymentProvider,
  PaymentStatus,
  PlanStatus,
  SubscriptionStatus,
} from '@roviq/ee-billing-types';

registerEnumType(BillingInterval, {
  name: 'BillingInterval',
  description: 'Billing cycle frequency for subscription plans.',
});

registerEnumType(SubscriptionStatus, {
  name: 'SubscriptionStatus',
  description: 'Current state of a subscription.',
});

registerEnumType(InvoiceStatus, {
  name: 'InvoiceStatus',
  description: 'Payment status of an invoice.',
});

registerEnumType(PaymentProvider, {
  name: 'PaymentProvider',
  description: 'Supported payment gateway providers.',
});

registerEnumType(PlanStatus, {
  name: 'PlanStatus',
  description: 'Lifecycle status of a subscription plan.',
});

registerEnumType(GatewayConfigStatus, {
  name: 'GatewayConfigStatus',
  description: 'Status of a payment gateway configuration.',
});

registerEnumType(PaymentStatus, {
  name: 'PaymentStatus',
  description: 'Current state of a payment record.',
});

registerEnumType(PaymentMethod, {
  name: 'PaymentMethod',
  description: 'Payment method used (gateway or manual).',
});
