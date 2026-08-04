// ============================================================================
// MODULE : Mock Data — Subscriptions
// PURPOSE: One subscription per tenant, derived from that tenant rather than
//          declared separately.
//
//          Deriving it is what keeps the two consistent: a SUSPENDED tenant
//          gets a PAST_DUE subscription and a TRIAL tenant a TRIAL one, so the
//          console never shows an active plan against a suspended institution.
//          Hand-writing a second list would let exactly that drift in.
//
//          maxStorage and pricePerMonth are strings, matching the wire format —
//          the column is BigInt (serialize() converts it, since JSON.stringify
//          throws on BigInt) and Decimal(10,2) respectively.
// ============================================================================

import type { Subscription, Tenant } from "@/types";
import { daysAgo, daysAhead } from "../utils";
import { MOCK_TENANTS } from "./tenants";

/** Plan tiers, with the limits and pricing the console displays. */
const PLANS = {
  STARTER: { maxStudents: 500, maxFaculty: 50, storageGb: 25, monthly: "14999.00" },
  GROWTH: { maxStudents: 2500, maxFaculty: 200, storageGb: 100, monthly: "39999.00" },
  ENTERPRISE: { maxStudents: 15000, maxFaculty: 1200, storageGb: 500, monthly: "124999.00" },
  CUSTOM: { maxStudents: 50000, maxFaculty: 4000, storageGb: 2000, monthly: "249999.00" },
} as const;

const GIGABYTE = 1024 * 1024 * 1024;

/**
 * A tenant's plan tier, inferred from its type and age.
 *
 * Universities carry the largest enrolments and land on the top tiers; a single
 * school or a brand-new trial does not. This produces a realistic distribution
 * across the pricing table without a second hand-maintained mapping.
 */
function planFor(tenant: Tenant): keyof typeof PLANS {
  if (tenant.status === "TRIAL") return "STARTER";
  if (tenant.type === "UNIVERSITY") {
    return (tenant.establishedYear ?? 2000) < 1990 ? "CUSTOM" : "ENTERPRISE";
  }
  if (tenant.type === "INSTITUTE" || tenant.type === "COLLEGE") return "GROWTH";
  return "STARTER";
}

/**
 * Subscription status implied by the tenant's own status.
 *
 * A suspended institution is suspended *because* billing lapsed, so PAST_DUE is
 * the cause rather than a coincidence. Keeping the two in step means the
 * subscriptions table and the tenant table can never contradict each other.
 */
function statusFor(tenant: Tenant): Subscription["status"] {
  switch (tenant.status) {
    case "TRIAL":
      return "TRIAL";
    case "SUSPENDED":
      return "PAST_DUE";
    case "CANCELLED":
      return "CANCELLED";
    default:
      return "ACTIVE";
  }
}

function buildSubscription(tenant: Tenant, index: number): Subscription {
  const planKey = planFor(tenant);
  const plan = PLANS[planKey];
  const status = statusFor(tenant);

  // Annual for the larger commitments, monthly for entry tiers and trials —
  // the mix is what makes the billing-cycle column worth showing.
  const billingCycle =
    planKey === "ENTERPRISE" || planKey === "CUSTOM" ? "ANNUAL" : "MONTHLY";

  const ageDays = Math.max(
    1,
    Math.round((Date.parse(daysAgo(0)) - Date.parse(tenant.createdAt)) / 86_400_000)
  );

  return {
    id: `sub_${String(index + 1).padStart(3, "0")}`,
    tenantId: tenant.id,
    plan: planKey,
    status,
    billingCycle,
    // The subscription begins when the tenant was created.
    startDate: tenant.createdAt,
    // A trial has no end date yet; a cancelled one ended rather than renewing.
    endDate:
      status === "TRIAL"
        ? null
        : status === "CANCELLED"
          ? daysAgo(Math.max(1, ageDays - 300))
          : daysAhead(billingCycle === "ANNUAL" ? 240 : 25),
    // 14-day trial from signup, so recent trials are still live and older ones
    // have lapsed — which is what the dashboard's trial count needs to be real.
    trialEndsAt: status === "TRIAL" ? daysAgo(ageDays - 14) : null,
    maxStudents: plan.maxStudents,
    maxFaculty: plan.maxFaculty,
    maxStorage: String(plan.storageGb * GIGABYTE),
    features: null,
    pricePerMonth: status === "TRIAL" ? null : plan.monthly,
    currency: "INR",
    createdAt: tenant.createdAt,
    updatedAt: tenant.createdAt,
  };
}

export const MOCK_SUBSCRIPTIONS: Subscription[] = MOCK_TENANTS.map(buildSubscription);

export function findMockSubscription(id: string): Subscription | undefined {
  return MOCK_SUBSCRIPTIONS.find((subscription) => subscription.id === id);
}

export function findMockSubscriptionForTenant(tenantId: string): Subscription | undefined {
  return MOCK_SUBSCRIPTIONS.find((subscription) => subscription.tenantId === tenantId);
}

/**
 * Monthly recurring revenue across all paying subscriptions, as a number.
 *
 * Trials and cancelled subscriptions contribute nothing. An annual commitment
 * is still counted at its monthly rate, because MRR is the comparable figure —
 * mixing annual totals into it would overstate the month by twelvefold.
 *
 * Parsing to Number is safe at this scale and is display-only. Anything that
 * settles money must work from the Decimal string, never from this.
 */
export function mockMonthlyRevenue(): number {
  return MOCK_SUBSCRIPTIONS.filter((s) => s.status === "ACTIVE" || s.status === "PAST_DUE")
    .reduce((total, s) => total + Number(s.pricePerMonth ?? 0), 0);
}
