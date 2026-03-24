/**
 * Shared PubSub instance for GraphQL subscriptions across OSS and EE.
 *
 * Uses in-memory PubSub from graphql-subscriptions.
 * For production with multiple API gateway instances, replace with
 * a Redis-backed or NATS-backed PubSub implementation.
 */
import { PubSub } from 'graphql-subscriptions';

export const pubSub = new PubSub();
