import { describe, it, expect } from '@jest/globals';
import { canUse, resolvePlan, entitlementSnapshot, PLAN_CATALOG } from '../src/plans/entitlements';

describe('Free-tier entitlements', () => {
  it('FREE plan has zero price and real software capabilities', () => {
    const free = resolvePlan('FREE');
    expect(free.priceMonthlyUsd).toBe(0);
    expect(canUse('FREE', 'ain.inference')).toBe(true);
    expect(canUse('FREE', 'ain.workspace')).toBe(true);
    expect(canUse('FREE', 'ain.projects')).toBe(true);
  });

  it('FREE does not include invite_members (upgrade path)', () => {
    expect(canUse('FREE', 'ain.invite_members')).toBe(false);
    expect(canUse('SMALL_BUSINESS', 'ain.invite_members')).toBe(true);
  });

  it('payment alone never grants bank.basic without financialEligibility', () => {
    expect(canUse('ENTERPRISE', 'bank.basic')).toBe(false);
    expect(canUse('ENTERPRISE', 'bank.basic', { financialEligibility: true })).toBe(true);
  });

  it('mainnet settlement never available via entitlement alone without eligibility', () => {
    expect(canUse('PROFESSIONAL', 'mainnet.settlement')).toBe(false);
  });

  it('entitlement snapshot remains METERING_ONLY', () => {
    const snap = entitlementSnapshot('FREE');
    expect(snap.billingStatus).toBe('NOT_CONFIGURED');
    expect(snap.usageMode).toBe('METERING_ONLY');
    expect(snap.financialEligibility).toBe(false);
    expect(snap.quotaRequestsPerDay).toBe(100);
  });

  it('catalog includes Galaxia commercial tiers', () => {
    expect(Object.keys(PLAN_CATALOG)).toEqual(
      expect.arrayContaining(['FREE', 'SMALL_BUSINESS', 'BUSINESS', 'PROFESSIONAL', 'ENTERPRISE'])
    );
    expect(PLAN_CATALOG.SMALL_BUSINESS.priceMonthlyUsd).toBe(49);
    expect(PLAN_CATALOG.BUSINESS.priceMonthlyUsd).toBe(99);
    expect(PLAN_CATALOG.PROFESSIONAL.priceMonthlyUsd).toBe(249);
  });
});
