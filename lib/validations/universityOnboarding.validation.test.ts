// ============================================================================
// OWNER  : Gauransh
// MODULE : University Onboarding (W1.5 — PRD §5.1, §49.1)
// LAYER  : Validation — Unit Tests
// PURPOSE: Prove two things the PRD is the authority on.
//
//          FIRST, that the onboarding stages are §49.1's twelve, in §49.1's
//          order, and that the application constant and the Prisma enum have
//          not drifted apart. The stage list is the one part of W1.5 that was
//          transcribed from a document rather than derived from the schema, so
//          it is the one part a test has to hold in place.
//
//          SECOND, that the configuration schemas refuse what would corrupt a
//          tenant: a body-supplied tenantId, a colour that is not a colour, and
//          an academic year that ends before it starts.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  ONBOARDING_STAGES,
  onboardingStepSchema,
  platformAcademicYearSchema,
  platformBrandingSchema,
  platformCampusSchema,
  moduleSelectionSchema,
  tenantArchiveSchema,
  updateSubscriptionSchema,
  updateTenantSchema,
} from "@/lib/validations/platform";
import { OnboardingStage } from "@/app/generated/prisma/enums";

describe("ONBOARDING_STAGES (PRD §49.1)", () => {
  it("is the PRD's twelve stages in the PRD's order", () => {
    // Transcribed from §49.1's arrow-chain: "University Enquiry → Commercial
    // Approval → Tenant Creation → Domain Configuration → Branding
    // Configuration → Module Selection → Academic Setup → Data Import → User
    // Creation → Training → UAT → Go Live".
    assert.deepEqual(
      [...ONBOARDING_STAGES],
      [
        "UNIVERSITY_ENQUIRY",
        "COMMERCIAL_APPROVAL",
        "TENANT_CREATION",
        "DOMAIN_CONFIGURATION",
        "BRANDING_CONFIGURATION",
        "MODULE_SELECTION",
        "ACADEMIC_SETUP",
        "DATA_IMPORT",
        "USER_CREATION",
        "TRAINING",
        "UAT",
        "GO_LIVE",
      ]
    );
  });

  it("agrees exactly with the Prisma enum", () => {
    // The application constant drives the UI order and the API's Zod enum; the
    // Prisma enum drives the column. A value in one and not the other is a
    // stage that either cannot be stored or cannot be shown.
    assert.deepEqual([...ONBOARDING_STAGES].sort(), Object.values(OnboardingStage).sort());
  });

  it("has no duplicates", () => {
    assert.equal(new Set(ONBOARDING_STAGES).size, ONBOARDING_STAGES.length);
  });
});

describe("onboardingStepSchema", () => {
  it("accepts a stage, with or without a note", () => {
    assert.equal(onboardingStepSchema.safeParse({ stage: "UAT" }).success, true);
    assert.equal(
      onboardingStepSchema.safeParse({ stage: "DATA_IMPORT", note: "Reconciled 1,204 students" })
        .success,
      true
    );
  });

  it("rejects a stage the PRD does not define", () => {
    assert.equal(onboardingStepSchema.safeParse({ stage: "KICKOFF" }).success, false);
    assert.equal(onboardingStepSchema.safeParse({ stage: "GO-LIVE" }).success, false);
  });

  it("REFUSES completedBy — sign-off comes from the session, not the body", () => {
    // Strict. Otherwise one operator could record a colleague as having signed
    // off a stage they never saw.
    assert.equal(
      onboardingStepSchema.safeParse({ stage: "UAT", completedBy: "someone_else" }).success,
      false
    );
  });

  it("REFUSES completedAt — the timestamp is the server's", () => {
    assert.equal(
      onboardingStepSchema.safeParse({ stage: "UAT", completedAt: "2020-01-01" }).success,
      false
    );
  });
});

describe("platformCampusSchema (PRD §5.1 campuses and affiliated colleges)", () => {
  it("accepts a campus", () => {
    assert.equal(
      platformCampusSchema.safeParse({ name: "Main Campus", code: "MAIN", isMain: true }).success,
      true
    );
  });

  it("REFUSES a tenantId — it comes from the route segment", () => {
    // A body-supplied tenant id is how a campus ends up under the wrong
    // university.
    assert.equal(
      platformCampusSchema.safeParse({ name: "Main", code: "MAIN", tenantId: "other_tenant" })
        .success,
      false
    );
  });

  it("requires a name and a code", () => {
    assert.equal(platformCampusSchema.safeParse({ code: "MAIN" }).success, false);
    assert.equal(platformCampusSchema.safeParse({ name: "Main", code: "  " }).success, false);
  });
});

describe("platformAcademicYearSchema (PRD §5.1 configure academic year)", () => {
  const VALID = { name: "2026-27", startDate: "2026-07-01", endDate: "2027-06-30" };

  it("accepts a well-formed year", () => {
    assert.equal(platformAcademicYearSchema.safeParse(VALID).success, true);
  });

  it("REJECTS an end date that is not after the start", () => {
    // An inverted year silently breaks every semester and batch hung off it.
    assert.equal(
      platformAcademicYearSchema.safeParse({ ...VALID, endDate: "2026-06-30" }).success,
      false
    );
    assert.equal(
      platformAcademicYearSchema.safeParse({ ...VALID, endDate: VALID.startDate }).success,
      false
    );
  });

  it("REFUSES a tenantId", () => {
    assert.equal(
      platformAcademicYearSchema.safeParse({ ...VALID, tenantId: "other_tenant" }).success,
      false
    );
  });
});

describe("platformBrandingSchema (PRD §5.1 logo and branding)", () => {
  it("accepts hex colours and URLs", () => {
    assert.equal(
      platformBrandingSchema.safeParse({
        logoUrl: "https://cdn.example.com/logo.svg",
        primaryColor: "#1d4ed8",
        accentColor: "#fa0",
      }).success,
      true
    );
  });

  it("accepts null to CLEAR a value", () => {
    // A university dropping its logo mid-onboarding must be able to return to
    // the platform default rather than being stuck with a broken image URL.
    assert.equal(platformBrandingSchema.safeParse({ logoUrl: null }).success, true);
  });

  it("REJECTS a colour that is not hex", () => {
    // These values are written into CSS custom properties by the existing
    // branding implementation, so a free string would reach a stylesheet.
    for (const bad of ["red", "rgb(0,0,0)", "#12", "#1234", "javascript:alert(1)"]) {
      assert.equal(
        platformBrandingSchema.safeParse({ primaryColor: bad }).success,
        false,
        `expected "${bad}" to be refused`
      );
    }
  });

  it("REJECTS a logo that is not a URL", () => {
    assert.equal(platformBrandingSchema.safeParse({ logoUrl: "not-a-url" }).success, false);
  });

  it("REJECTS an empty body rather than advancing updatedAt for nothing", () => {
    assert.equal(platformBrandingSchema.safeParse({}).success, false);
  });

  it("REFUSES name and slug — branding is four columns, not a tenant editor", () => {
    assert.equal(
      platformBrandingSchema.safeParse({ logoUrl: null, name: "Renamed" }).success,
      false
    );
  });
});

describe("W1.5 additions to the existing update contracts", () => {
  it("tenant update accepts supportManagerId, including null to unassign", () => {
    // PRD §5.1 "Assign support manager".
    assert.equal(updateTenantSchema.safeParse({ supportManagerId: "pu_1" }).success, true);
    assert.equal(updateTenantSchema.safeParse({ supportManagerId: null }).success, true);
  });

  it("subscription update accepts maxCourses", () => {
    // PRD §5.1 "Set limits for users, storage and courses" — the third limit,
    // which had no column before W1.5.
    assert.equal(updateSubscriptionSchema.safeParse({ maxCourses: 500 }).success, true);
    assert.equal(updateSubscriptionSchema.safeParse({ maxCourses: 0 }).success, true);
  });

  it("rejects a negative or fractional course limit", () => {
    assert.equal(updateSubscriptionSchema.safeParse({ maxCourses: -1 }).success, false);
    assert.equal(updateSubscriptionSchema.safeParse({ maxCourses: 1.5 }).success, false);
  });
});

describe("moduleSelectionSchema (PRD §2.1, §5.1, §57)", () => {
  it("accepts catalogue keys", () => {
    assert.equal(
      moduleSelectionSchema.safeParse({ modules: { admissions: true, fees: false } }).success,
      true
    );
  });

  it("REJECTS a key the PRD never named", () => {
    // This is the whole point of constraining the column: the junk that a real
    // tenant carries must not be submittable as a module.
    assert.equal(moduleSelectionSchema.safeParse({ modules: { jhjj: true } }).success, false);
    assert.equal(
      moduleSelectionSchema.safeParse({ modules: { admissions: true, jhjj: true } }).success,
      false
    );
  });

  it("REJECTS a non-boolean module state", () => {
    assert.equal(moduleSelectionSchema.safeParse({ modules: { admissions: "yes" } }).success, false);
  });

  it("REFUSES a tenantId or subscriptionId in the body", () => {
    // The tenant comes from the route; the subscription is resolved from it.
    assert.equal(
      moduleSelectionSchema.safeParse({ modules: {}, tenantId: "other" }).success,
      false
    );
    assert.equal(
      moduleSelectionSchema.safeParse({ modules: {}, subscriptionId: "sub_1" }).success,
      false
    );
  });
});

describe("tenantArchiveSchema (PRD §5.1, §46.3)", () => {
  it("accepts an archive with a reason, and a restore", () => {
    assert.equal(tenantArchiveSchema.safeParse({ reason: "Contract ended" }).success, true);
    assert.equal(tenantArchiveSchema.safeParse({ restore: true }).success, true);
    assert.equal(tenantArchiveSchema.safeParse({}).success, true);
  });

  it("REFUSES retention and purge fields the PRD does not define", () => {
    // §46.3 names "Data-retention policies" without specifying one. Accepting a
    // retention period here would be inventing the policy.
    for (const bad of [
      { retentionDays: 90 },
      { purgeAt: "2027-01-01" },
      { hardDelete: true },
      { exportFormat: "sql" },
    ]) {
      assert.equal(
        tenantArchiveSchema.safeParse(bad).success,
        false,
        `expected ${Object.keys(bad)[0]} to be refused`
      );
    }
  });

  it("rejects an empty reason rather than storing a blank one", () => {
    assert.equal(tenantArchiveSchema.safeParse({ reason: "   " }).success, false);
  });
});

describe("PRD §5.3 pricing basis on the subscription contract", () => {
  it("accepts the pricing models §5.3 enumerates", () => {
    for (const pricingModel of [
      "FLAT_PLAN",
      "MODULE_BASED",
      "PER_STUDENT",
      "PER_ACTIVE_USER",
      "PER_COURSE",
      "STORAGE_BASED",
    ]) {
      assert.equal(
        updateSubscriptionSchema.safeParse({ pricingModel }).success,
        true,
        `expected ${pricingModel} to be accepted`
      );
    }
  });

  it("accepts autoRenew — §5.3 'Auto-renewal management'", () => {
    assert.equal(updateSubscriptionSchema.safeParse({ autoRenew: false }).success, true);
  });

  it("REJECTS payment-term fields the PRD does not define (GAP-02)", () => {
    // §5.3 defines pricing bases and billing cycle. It defines no due day, no
    // net period, no grace and no late fee, so none is accepted.
    for (const bad of [
      { paymentTerms: "NET_30" },
      { dueDay: 15 },
      { gracePeriodDays: 7 },
      { lateFeePercent: 2 },
      { advancePayment: true },
    ]) {
      assert.equal(
        updateSubscriptionSchema.safeParse(bad).success,
        false,
        `expected ${Object.keys(bad)[0]} to be refused`
      );
    }
  });
});
