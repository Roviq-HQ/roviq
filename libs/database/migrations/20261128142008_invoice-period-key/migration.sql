-- One live invoice per subscription and billing period. Existing rows that share a period are
-- reported, not changed: cancel the extra invoices, then run the migration again.
DO $$
DECLARE
  extra bigint;
BEGIN
  SELECT COALESCE(sum(n - 1), 0) INTO extra FROM (
    SELECT count(*) AS n FROM invoices
     WHERE period_start IS NOT NULL AND status NOT IN ('CANCELLED', 'REFUNDED')
     GROUP BY subscription_id, period_start HAVING count(*) > 1
  ) AS shared;
  IF extra > 0 THEN
    RAISE EXCEPTION '% invoice(s) share a subscription and billing period with another live invoice; cancel them before this migration', extra;
  END IF;
END
$$;
--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_subscription_period_key" ON "invoices" ("subscription_id","period_start") WHERE "period_start" IS NOT NULL AND "status" NOT IN ('CANCELLED', 'REFUNDED');