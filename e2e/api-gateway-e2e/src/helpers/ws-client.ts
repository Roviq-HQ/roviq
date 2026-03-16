import { createClient } from 'graphql-ws';
import WebSocket from 'ws';

const WS_URL = process.env.WS_URL ?? 'ws://localhost:3000/api/graphql';

/**
 * Subscribe to a GraphQL subscription and resolve with the first received event.
 * Automatically cleans up after receiving one event or on timeout.
 */
export function subscribeOnce<T>(
  query: string,
  variables: Record<string, unknown>,
  token: string,
  timeoutMs = 5000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Subscription timeout')), timeoutMs);

    const client = createClient({
      url: WS_URL,
      webSocketImpl: WebSocket,
      connectionParams: { Authorization: `Bearer ${token}` },
    });

    const unsubscribe = client.subscribe(
      { query, variables },
      {
        next: (data) => {
          clearTimeout(timer);
          unsubscribe();
          client.dispose();
          resolve(data.data as T);
        },
        error: (err) => {
          clearTimeout(timer);
          reject(err);
        },
        complete: () => {},
      },
    );
  });
}
