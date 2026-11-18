declare global {
  namespace NodeJS {
    interface ProcessEnv {
      NODE_ENV?: 'development' | 'production' | 'test';
      DATABASE_URL?: string;
      DATABASE_URL_TEST?: string;
      DATABASE_URL_MIGRATE?: string;
      DATABASE_URL_TEST_MIGRATE?: string;
      DATABASE_URL_ADMIN?: string;
      JWT_SECRET?: string;
      JWT_REFRESH_SECRET?: string;
      NATS_URL?: string;
      NATS_TEST_URL?: string;
      NATS_STREAM_DRIFT_RECREATE?: string;
      REDIS_URL?: string;
      LOG_LEVEL?: string;
      TEMPORAL_ADDRESS?: string;
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
      PROMETHEUS_URL?: string;
      /** Host port of this instance's Prometheus (slot 0: 9090); fallback when PROMETHEUS_URL is unset. */
      DEV_PROMETHEUS_PORT?: string;
      LOKI_URL?: string;
      TEMPO_URL?: string;
      NEXT_PUBLIC_GRAFANA_URL?: string;
      DEV_TEMPO_PORT?: string;
      DEV_LOKI_PORT?: string;
      /** Host port of this instance's isolated NATS test broker (slot 0: 4224). */
      DEV_NATS_TEST_PORT?: string;
      /** Host port of this instance's dev API gateway (slot 0: 3005). */
      API_GATEWAY_PORT?: string;
      E2E_API_PORT?: string;
      E2E_WEB_PORT?: string;
      E2E_POSTGRES_PORT?: string;
      E2E_NATS_PORT?: string;
      E2E_NOVU_API_PORT?: string;
      ROVIQ_E2E_COMPOSE_PROJECT?: string;
    }
  }
}

export {};
