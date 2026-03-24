/**
 * Shared PubSub instance for GraphQL subscriptions.
 *
 * Uses in-memory PubSub from graphql-subscriptions.
 * For production with multiple API gateway instances, replace with
 * a NATS-backed or Redis-backed PubSub implementation.
 */
import { PubSub } from 'graphql-subscriptions';

export const pubSub = new PubSub();
