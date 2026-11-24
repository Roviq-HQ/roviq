-- ROV-327: a read report and a held message are delivery states of their own.
ALTER TYPE "NotificationDeliveryStatus" ADD VALUE 'READ';--> statement-breakpoint
ALTER TYPE "NotificationDeliveryStatus" ADD VALUE 'DEFERRED';
