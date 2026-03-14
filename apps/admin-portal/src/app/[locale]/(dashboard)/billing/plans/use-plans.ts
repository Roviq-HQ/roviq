'use client';

import type { FeatureLimits } from '@roviq/ee-billing-types';
import { gql, useMutation, useQuery } from '@roviq/graphql';

// --- Types ---

export interface SubscriptionPlanNode {
  id: string;
  name: string;
  description: string | null;
  amount: number;
  currency: string;
  billingInterval: 'MONTHLY' | 'QUARTERLY' | 'YEARLY';
  featureLimits: FeatureLimits;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface SubscriptionPlansData {
  subscriptionPlans: SubscriptionPlanNode[];
}

interface CreateSubscriptionPlanData {
  createSubscriptionPlan: SubscriptionPlanNode;
}

interface UpdateSubscriptionPlanData {
  updateSubscriptionPlan: SubscriptionPlanNode;
}

interface CreatePlanInput {
  name: string;
  description?: string;
  amount: number;
  currency?: string;
  billingInterval: 'MONTHLY' | 'QUARTERLY' | 'YEARLY';
  featureLimits: FeatureLimits;
}

interface UpdatePlanInput {
  name?: string;
  description?: string;
  amount?: number;
  billingInterval?: 'MONTHLY' | 'QUARTERLY' | 'YEARLY';
  featureLimits?: FeatureLimits;
  isActive?: boolean;
}

// --- Queries ---

const SUBSCRIPTION_PLANS_QUERY = gql`
  query SubscriptionPlans {
    subscriptionPlans {
      id
      name
      description
      amount
      currency
      billingInterval
      featureLimits
      isActive
      createdAt
      updatedAt
    }
  }
`;

const CREATE_PLAN_MUTATION = gql`
  mutation CreateSubscriptionPlan($input: CreatePlanInput!) {
    createSubscriptionPlan(input: $input) {
      id
      name
      description
      amount
      currency
      billingInterval
      featureLimits
      isActive
      createdAt
      updatedAt
    }
  }
`;

const UPDATE_PLAN_MUTATION = gql`
  mutation UpdateSubscriptionPlan($id: ID!, $input: UpdatePlanInput!) {
    updateSubscriptionPlan(id: $id, input: $input) {
      id
      name
      description
      amount
      currency
      billingInterval
      featureLimits
      isActive
      createdAt
      updatedAt
    }
  }
`;

// --- Hooks ---

export function useSubscriptionPlans() {
  const { data, loading, error, refetch } =
    useQuery<SubscriptionPlansData>(SUBSCRIPTION_PLANS_QUERY);

  return {
    plans: data?.subscriptionPlans ?? [],
    loading,
    error,
    refetch,
  };
}

export function useCreatePlan() {
  return useMutation<CreateSubscriptionPlanData, { input: CreatePlanInput }>(CREATE_PLAN_MUTATION, {
    refetchQueries: ['SubscriptionPlans'],
  });
}

export function useUpdatePlan() {
  return useMutation<UpdateSubscriptionPlanData, { id: string; input: UpdatePlanInput }>(
    UPDATE_PLAN_MUTATION,
    { refetchQueries: ['SubscriptionPlans'] },
  );
}
