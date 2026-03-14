-- Rename TRIALING → PENDING_PAYMENT in SubscriptionStatus enum
ALTER TYPE "SubscriptionStatus" RENAME VALUE 'TRIALING' TO 'PENDING_PAYMENT';
