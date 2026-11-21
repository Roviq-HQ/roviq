import type { InstituteContext, PlatformContext, ResellerContext } from '@roviq/common-types';
import { createMock } from '@roviq/testing';
import { describe, expect, it } from 'vitest';
import { isOwnInstituteEvent, isOwnResellerEvent } from '../billing-subscriptions.resolver';

const TENANT_A = '019d0000-0000-7000-8000-00000000000a';
const TENANT_B = '019d0000-0000-7000-8000-00000000000b';
const RESELLER_A = '019d0000-0000-7000-8000-0000000000a1';
const RESELLER_B = '019d0000-0000-7000-8000-0000000000b1';
const KEY = 'billingInvoiceGenerated';

const instituteUser = (tenantId: string) => ({
  req: { user: createMock<InstituteContext>({ scope: 'institute', tenantId }) },
});
const resellerUser = (resellerId: string) => ({
  req: { user: createMock<ResellerContext>({ scope: 'reseller', resellerId }) },
});
const platformUser = () => ({
  req: { user: createMock<PlatformContext>({ scope: 'platform' }) },
});

const event = (owner: { tenantId?: string; resellerId?: string }) => ({ [KEY]: owner });

describe('isOwnInstituteEvent', () => {
  it('should deliver an event raised for the caller institute', () => {
    const payload = event({ tenantId: TENANT_A, resellerId: RESELLER_A });

    expect(isOwnInstituteEvent(KEY, payload, instituteUser(TENANT_A))).toBe(true);
  });

  it('should hold back an event raised for another institute', () => {
    const payload = event({ tenantId: TENANT_B, resellerId: RESELLER_A });

    expect(isOwnInstituteEvent(KEY, payload, instituteUser(TENANT_A))).toBe(false);
  });

  it('should hold back an event that names no institute', () => {
    expect(isOwnInstituteEvent(KEY, event({}), instituteUser(TENANT_A))).toBe(false);
  });

  it('should hold back an event published under a different key', () => {
    const payload = { billingPaymentSucceeded: { tenantId: TENANT_A } };

    expect(isOwnInstituteEvent(KEY, payload, instituteUser(TENANT_A))).toBe(false);
  });

  it('should hold back every event from a reseller or platform caller', () => {
    const payload = event({ tenantId: TENANT_A, resellerId: RESELLER_A });

    expect(isOwnInstituteEvent(KEY, payload, resellerUser(RESELLER_A))).toBe(false);
    expect(isOwnInstituteEvent(KEY, payload, platformUser())).toBe(false);
  });
});

describe('isOwnResellerEvent', () => {
  it('should deliver an event of an institute the caller reseller owns', () => {
    const payload = event({ tenantId: TENANT_A, resellerId: RESELLER_A });

    expect(isOwnResellerEvent(KEY, payload, resellerUser(RESELLER_A))).toBe(true);
  });

  it('should hold back an event that belongs to another reseller', () => {
    const payload = event({ tenantId: TENANT_A, resellerId: RESELLER_B });

    expect(isOwnResellerEvent(KEY, payload, resellerUser(RESELLER_A))).toBe(false);
  });

  it('should hold back an event that names no reseller', () => {
    const payload = event({ tenantId: TENANT_A });

    expect(isOwnResellerEvent(KEY, payload, resellerUser(RESELLER_A))).toBe(false);
  });

  it('should hold back every event from an institute or platform caller', () => {
    const payload = event({ tenantId: TENANT_A, resellerId: RESELLER_A });

    expect(isOwnResellerEvent(KEY, payload, instituteUser(TENANT_A))).toBe(false);
    expect(isOwnResellerEvent(KEY, payload, platformUser())).toBe(false);
  });
});
