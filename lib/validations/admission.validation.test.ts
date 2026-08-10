// ============================================================================
// OWNER  : Gauransh
// MODULE : Admissions (W3 — PRD §8.2, §8.5, §9.1, §49.2)
// LAYER  : Validation + workflow — Unit Tests
// PURPOSE: Pin the §49.2 stage list to the PRD, prove the sequential transition
//          rule, and prove what a client may never supply.
//
//          Identifiers and workflow state are server-owned; the assertions that
//          matter most are therefore the REFUSALS.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  ADMISSION_STAGES,
  ADMISSION_STAGE_LABELS,
  advanceStageSchema,
  applicationIdParamSchema,
  convertApplicationSchema,
  createApplicationSchema,
  listApplicationsQuerySchema,
  updateApplicationSchema,
} from "@/lib/validations/admission";
import { nextStage } from "@/lib/services/admission.service";
import { AdmissionStage } from "@/app/generated/prisma/enums";
import { IDENTIFIER_ENTITIES } from "@/lib/services/identifier.service";

const VALID = { firstName: "Asha", lastName: "Rao", email: "asha@applicant.test" };

describe("ADMISSION_STAGES (PRD §49.2)", () => {
  it("is the PRD's twelve stages in the PRD's order", () => {
    // §49.2: "Lead → Counselling → Application → Document Verification →
    // Eligibility Check → Entrance Examination → Merit or Selection → Offer
    // Letter → Fee Payment → Student ID Generation → Course Allocation →
    // Portal Activation".
    assert.deepEqual(
      [...ADMISSION_STAGES],
      [
        "LEAD",
        "COUNSELLING",
        "APPLICATION",
        "DOCUMENT_VERIFICATION",
        "ELIGIBILITY_CHECK",
        "ENTRANCE_EXAMINATION",
        "MERIT_OR_SELECTION",
        "OFFER_LETTER",
        "FEE_PAYMENT",
        "STUDENT_ID_GENERATION",
        "COURSE_ALLOCATION",
        "PORTAL_ACTIVATION",
      ]
    );
  });

  it("agrees exactly with the Prisma enum", () => {
    assert.deepEqual([...ADMISSION_STAGES].sort(), Object.values(AdmissionStage).sort());
  });

  it("labels every stage", () => {
    for (const stage of ADMISSION_STAGES) {
      assert.ok(ADMISSION_STAGE_LABELS[stage], `${stage} has no label`);
    }
  });

  it("invents no status outside §49.2", () => {
    // APPLIED / SHORTLISTED / REJECTED / WAITLISTED / ADMITTED are NOT PRD
    // vocabulary and must not appear.
    for (const invented of ["APPLIED", "SHORTLISTED", "REJECTED", "WAITLISTED", "ADMITTED"]) {
      assert.ok(
        !(ADMISSION_STAGES as readonly string[]).includes(invented),
        `${invented} is not a PRD stage`
      );
    }
  });
});

describe("nextStage — sequential only", () => {
  it("advances exactly one step", () => {
    assert.equal(nextStage("LEAD"), "COUNSELLING");
    assert.equal(nextStage("OFFER_LETTER"), "FEE_PAYMENT");
    assert.equal(nextStage("COURSE_ALLOCATION"), "PORTAL_ACTIVATION");
  });

  it("returns null at the final stage", () => {
    assert.equal(nextStage("PORTAL_ACTIVATION"), null);
  });

  it("covers every stage but the last", () => {
    for (const stage of ADMISSION_STAGES.slice(0, -1)) {
      assert.ok(nextStage(stage), `${stage} has no successor`);
    }
  });
});

describe("identifier engine (PRD §9.1)", () => {
  it("now issues APPLICANT and APPLICATION", () => {
    // §9.1 names "Applicant ID" and "Application number" among its supported
    // IDs, so these extend the existing engine rather than inventing a scheme.
    assert.ok((IDENTIFIER_ENTITIES as readonly string[]).includes("APPLICANT"));
    assert.ok((IDENTIFIER_ENTITIES as readonly string[]).includes("APPLICATION"));
  });

  it("keeps the pre-existing types intact", () => {
    for (const existing of ["STUDENT", "FACULTY", "EMPLOYEE", "CERTIFICATE"]) {
      assert.ok((IDENTIFIER_ENTITIES as readonly string[]).includes(existing));
    }
  });
});

describe("createApplicationSchema (PRD §8.2)", () => {
  it("accepts the minimum §8.2 requires", () => {
    assert.equal(createApplicationSchema.safeParse(VALID).success, true);
  });

  it("lowercases the email, so duplicate detection is effective", () => {
    const result = createApplicationSchema.safeParse({ ...VALID, email: "Asha@Applicant.TEST" });
    assert.equal(result.data?.email, "asha@applicant.test");
  });

  it("REFUSES tenantId, both identifiers, stage and studentId", () => {
    // Every one is server-owned. Strict, so each is a 400 rather than ignored.
    for (const forbidden of [
      { tenantId: "another_university" },
      { applicantNo: "APP/1" },
      { applicationNo: "APN/1" },
      { stage: "PORTAL_ACTIVATION" },
      { studentId: "s_1" },
      { convertedAt: "2026-01-01" },
    ]) {
      assert.equal(
        createApplicationSchema.safeParse({ ...VALID, ...forbidden }).success,
        false,
        `expected ${Object.keys(forbidden)[0]} to be refused`
      );
    }
  });

  it("accepts free-form education and work history without prescribing keys", () => {
    // §8.2 names both and defines no field for either.
    const result = createApplicationSchema.safeParse({
      ...VALID,
      educationHistory: [{ school: "St Xavier", year: 2024, grade: "A" }],
      workHistory: [{ employer: "Acme", months: 6 }],
    });
    assert.equal(result.success, true);
  });

  it("bounds history size and rejects nesting", () => {
    assert.equal(
      createApplicationSchema.safeParse({
        ...VALID,
        educationHistory: Array.from({ length: 21 }, () => ({ a: "b" })),
      }).success,
      false
    );
    assert.equal(
      createApplicationSchema.safeParse({
        ...VALID,
        workHistory: [{ nested: { deep: "value" } }],
      }).success,
      false
    );
  });

  it("REJECTS duplicate programme preferences and duplicate priorities", () => {
    // A preference list whose order is ambiguous is not a preference list.
    assert.equal(
      createApplicationSchema.safeParse({
        ...VALID,
        preferences: [
          { programmeId: "p1", priority: 1 },
          { programmeId: "p1", priority: 2 },
        ],
      }).success,
      false
    );
    assert.equal(
      createApplicationSchema.safeParse({
        ...VALID,
        preferences: [
          { programmeId: "p1", priority: 1 },
          { programmeId: "p2", priority: 1 },
        ],
      }).success,
      false
    );
  });

  it("requires name and a valid email", () => {
    assert.equal(createApplicationSchema.safeParse({ ...VALID, firstName: "  " }).success, false);
    assert.equal(createApplicationSchema.safeParse({ ...VALID, email: "nope" }).success, false);
  });
});

describe("updateApplicationSchema", () => {
  it("accepts a single field", () => {
    assert.equal(updateApplicationSchema.safeParse({ phone: "+91 90000 00000" }).success, true);
  });

  it("REJECTS an empty body", () => {
    assert.equal(updateApplicationSchema.safeParse({}).success, false);
  });

  it("REFUSES stage — the workflow has its own endpoint", () => {
    // §4 of this work package: the client may not set any stage directly.
    assert.equal(
      updateApplicationSchema.safeParse({ phone: "1", stage: "OFFER_LETTER" }).success,
      false
    );
  });
});

describe("advanceStageSchema", () => {
  it("requires a PRD stage as the target", () => {
    assert.equal(advanceStageSchema.safeParse({ toStage: "COUNSELLING" }).success, true);
    assert.equal(advanceStageSchema.safeParse({ toStage: "ADMITTED" }).success, false);
  });

  it("REFUSES an applicationId or tenantId in the body", () => {
    assert.equal(
      advanceStageSchema.safeParse({ toStage: "COUNSELLING", tenantId: "t" }).success,
      false
    );
    assert.equal(
      advanceStageSchema.safeParse({ toStage: "COUNSELLING", applicationId: "a" }).success,
      false
    );
  });
});

describe("convertApplicationSchema (PRD §8.5)", () => {
  it("requires programme and batch", () => {
    // §8.5 "Assigns programme and batch". Neither can be derived — the PRD
    // defines no rule for choosing among preferences.
    assert.equal(
      convertApplicationSchema.safeParse({ programmeId: "p1", batchId: "b1" }).success,
      true
    );
    assert.equal(convertApplicationSchema.safeParse({ programmeId: "p1" }).success, false);
    assert.equal(convertApplicationSchema.safeParse({ batchId: "b1" }).success, false);
  });

  it("REFUSES an enrolment number, password or role", () => {
    // The identifier engine issues the enrolment number; credentials follow the
    // W1.6 policy. None may be chosen by a caller.
    for (const forbidden of [
      { enrollmentNo: "E/1" },
      { password: "hunter2hunter2" },
      { role: "UNIVERSITY_ADMIN" },
      { studentId: "s_1" },
      { tenantId: "t_1" },
    ]) {
      assert.equal(
        convertApplicationSchema.safeParse({ programmeId: "p1", batchId: "b1", ...forbidden })
          .success,
        false,
        `expected ${Object.keys(forbidden)[0]} to be refused`
      );
    }
  });
});

describe("listApplicationsQuerySchema", () => {
  it("defaults pagination and coerces from search params", () => {
    const result = listApplicationsQuerySchema.safeParse({ page: "2", limit: "50" });
    assert.equal(result.data?.page, 2);
    assert.equal(result.data?.limit, 50);
  });

  it("treats a blank q as no search", () => {
    assert.equal(listApplicationsQuerySchema.safeParse({ q: "  " }).data?.q, undefined);
  });

  it("rejects a stage outside §49.2 and a request for the whole table", () => {
    assert.equal(listApplicationsQuerySchema.safeParse({ stage: "ADMITTED" }).success, false);
    assert.equal(listApplicationsQuerySchema.safeParse({ limit: "5000" }).success, false);
  });
});

describe("applicationIdParamSchema", () => {
  it("accepts any non-empty id and rejects blank", () => {
    assert.equal(applicationIdParamSchema.safeParse({ applicationId: "abc" }).success, true);
    assert.equal(applicationIdParamSchema.safeParse({ applicationId: "  " }).success, false);
  });
});
