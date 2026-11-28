declare global {
  namespace NodeJS {
    interface ProcessEnv {
      NODE_ENV?: 'development' | 'production' | 'test';
      DATABASE_URL?: string;
      DATABASE_URL_TEST?: string;
      INTEGRATION_EXCLUDE?: string;
      DATABASE_URL_MIGRATE?: string;
      /** On a managed PostgreSQL without superusers: the service's administrative role. */
      MIGRATION_ADMIN_ROLE?: string;
      DATABASE_URL_TEST_MIGRATE?: string;
      DATABASE_URL_ADMIN?: string;
      JWT_SECRET?: string;
      JWT_REFRESH_SECRET?: string;
      NATS_URL?: string;
      NATS_TEST_URL?: string;
      NATS_STREAM_DRIFT_RECREATE?: string;
      REDIS_URL?: string;
      ALLOWED_ORIGINS?: string;
      S3_ENDPOINT?: string;
      S3_PUBLIC_ENDPOINT?: string;
      S3_REGION?: string;
      S3_ACCESS_KEY?: string;
      S3_SECRET_KEY?: string;
      S3_SESSION_TOKEN?: string;
      S3_BUCKET_PRIVATE?: string;
      S3_BUCKET_PUBLIC?: string;
      S3_PUBLIC_BASE_URL?: string;
      LOG_LEVEL?: string;
      TEMPORAL_ADDRESS?: string;
      /** 'true' runs the hourly file sweeper worker in this gateway (ROV-300). */
      FILE_SWEEPER_WORKER_ENABLED?: string;
      /** Malware scanner for uploads: 'clamav', 'eicar' or 'off' (ROV-303). */
      FILE_SCANNER?: string;
      CLAMAV_HOST?: string;
      CLAMAV_PORT?: string;
      ROVIQ_EE?: string;
      BILLING_ENCRYPTION_KEY?: string;
      RAZORPAY_WEBHOOK_SECRET?: string;
      CASHFREE_WEBHOOK_SECRET?: string;
      DATABASE_URL_E2E?: string;
      CI?: string;
      API_URL?: string;
      E2E_VISUAL_SNAPSHOTS?: string;
      WEB_URL?: string;
      WS_URL?: string;
      MAX_LOGIN_ATTEMPTS?: string;
      LOCKOUT_DURATION_SECONDS?: string;
      FAILURE_WINDOW_SECONDS?: string;
      NATS_VALIDATE_PAYLOADS?: string;
      /** OTLP gRPC endpoint of OpenObserve; unset turns telemetry off. */
      OTEL_EXPORTER_OTLP_ENDPOINT?: string;
      /** gRPC metadata for the OTLP exporters: `authorization=Basic <base64>,organization=<org>,stream-name=default`. */
      OTEL_EXPORTER_OTLP_HEADERS?: string;
      /** HTTP base URL of OpenObserve for queries; unset: `http://localhost:$DEV_OPENOBSERVE_PORT`. */
      OPENOBSERVE_URL?: string;
      /** OpenObserve organization (default: `default`). */
      OPENOBSERVE_ORG?: string;
      OPENOBSERVE_USER?: string;
      OPENOBSERVE_PASSWORD?: string;
      /** Comma-separated recipients of alert emails; each must be an OpenObserve user. Unset: OPENOBSERVE_USER. */
      OPENOBSERVE_ALERT_EMAILS?: string;
      /** Host port of this instance's OpenObserve (slot 0: 5080); fallback when OPENOBSERVE_URL is unset. */
      DEV_OPENOBSERVE_PORT?: string;
      /** Browser-reachable OpenObserve URL for the admin portal's "Open in OpenObserve" links. */
      NEXT_PUBLIC_OPENOBSERVE_URL?: string;
      /** Origin of the institute portal, e.g. https://app.roviq.com. Unset: derived from the current host. */
      NEXT_PUBLIC_INSTITUTE_URL?: string;
      /** Host port of this instance's isolated NATS test broker (slot 0: 4224). */
      DEV_NATS_TEST_PORT?: string;
      /** Host port of this instance's dev API gateway (slot 0: 3005). */
      API_GATEWAY_PORT?: string;
      E2E_API_PORT?: string;
      E2E_WEB_PORT?: string;
      E2E_POSTGRES_PORT?: string;
      E2E_NATS_PORT?: string;
      /** Host port of this instance's e2e object storage (slot 0: 9004). */
      E2E_STORAGE_PORT?: string;
      /** Host port of this instance's e2e Mailpit API (slot 0: 8026). */
      E2E_MAILPIT_API_PORT?: string;
      ROVIQ_E2E_COMPOSE_PROJECT?: string;
    }
  }
}

export {};
