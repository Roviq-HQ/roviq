import { createMock } from '@roviq/testing';
import { describe, expect, it, vi } from 'vitest';
import type { SubscriptionPlanModel } from '../models/subscription-plan.model';
import { PlanFieldResolver } from '../plan-field.resolver';
import { SubscriptionRepository } from '../repositories/subscription.repository';

const PLAN_A = 'plan-a';
const PLAN_B = 'plan-b';

function plan(id: string) {
  return createMock<SubscriptionPlanModel>({ id });
}

function setup(counts: Map<string, number>) {
  const countByPlanIds = vi.fn(async (ids: string[]) => {
    return new Map(ids.flatMap((id) => (counts.has(id) ? [[id, counts.get(id) ?? 0]] : [])));
  });
  const repo = createMock<SubscriptionRepository>({ countByPlanIds });
  return { resolver: new PlanFieldResolver(repo), countByPlanIds };
}

describe('PlanFieldResolver.resolveSubscriberCount', () => {
  it('should return the new count on the next request after a subscription is added', async () => {
    const counts = new Map([[PLAN_A, 1]]);
    const { resolver } = setup(counts);

    expect(await resolver.resolveSubscriberCount(plan(PLAN_A))).toBe(1);

    counts.set(PLAN_A, 2);

    expect(await resolver.resolveSubscriberCount(plan(PLAN_A))).toBe(2);
  });

  it('should count every plan of one request in a single query', async () => {
    const { resolver, countByPlanIds } = setup(
      new Map([
        [PLAN_A, 3],
        [PLAN_B, 5],
      ]),
    );

    const result = await Promise.all([
      resolver.resolveSubscriberCount(plan(PLAN_A)),
      resolver.resolveSubscriberCount(plan(PLAN_B)),
    ]);

    expect(result).toEqual([3, 5]);
    expect(countByPlanIds).toHaveBeenCalledTimes(1);
    expect(countByPlanIds).toHaveBeenCalledWith([PLAN_A, PLAN_B]);
  });

  it('should return 0 for a plan with no subscription', async () => {
    const { resolver } = setup(new Map());

    expect(await resolver.resolveSubscriberCount(plan(PLAN_A))).toBe(0);
  });
});
