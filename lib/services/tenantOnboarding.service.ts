// ============================================================================
// OWNER  : Gauransh
// MODULE : University Onboarding (W1.5 — PRD §5.1, §49.1)
// LAYER  : Service — composes EXISTING models; adds one of its own.
// ACCESS : Called only from routes that have already run requirePlatformAdmin().
//
// WHAT §5.1 ASKS FOR AND WHAT THIS ANSWERS
//   "Track onboarding progress" and "University readiness checklist" are two
//   different questions, and this module keeps them apart on purpose:
//
//   PROGRESS  is what a platform operator has SIGNED OFF. Some §49.1 stages
//             happen outside the product entirely — Commercial Approval,
//             Training, UAT — and no query can observe them. They are recorded
//             as TenantOnboardingStep rows.
//
//   READINESS is what the DATABASE can actually prove. "Branding Configuration"
//             is either done or not, and the tenant's own columns say which. A
//             checklist that only reflected ticked boxes would report a
//             university ready while it had no administrator and no academic
//             year — which is precisely the state W1.4 showed is possible.
//
//   Both are returned together, so the screen can show a ticked stage whose
//   evidence is missing rather than quietly trusting the tick.
//
// THE STAGE LIST IS THE PRD'S, NOT THIS MODULE'S
//   §49.1's arrow-chain, in its own order, with nothing added or split. Where a
//   stage has no observable evidence, `evidence` is null and the checklist says
//   so instead of inventing a proxy signal.
// ============================================================================

import { prisma } from "@/lib/db/prisma";
import { ONBOARDING_STAGES, type OnboardingStageName } from "@/lib/validations/platform";
import { partitionFeatures } from "@/lib/constants/modules";
import type { OnboardingStage } from "@/app/generated/prisma/enums";

/** Human-facing stage labels. The PRD's own wording. */
const STAGE_LABELS: Record<OnboardingStageName, string> = {
  UNIVERSITY_ENQUIRY: "University Enquiry",
  COMMERCIAL_APPROVAL: "Commercial Approval",
  TENANT_CREATION: "Tenant Creation",
  DOMAIN_CONFIGURATION: "Domain Configuration",
  BRANDING_CONFIGURATION: "Branding Configuration",
  MODULE_SELECTION: "Module Selection",
  ACADEMIC_SETUP: "Academic Setup",
  DATA_IMPORT: "Data Import",
  USER_CREATION: "User Creation",
  TRAINING: "Training",
  UAT: "UAT",
  GO_LIVE: "Go Live",
};

/**
 * One stage of one university's onboarding.
 *
 * `evidence` is a THIRD state, not a duplicate of `completed`:
 *   true  — the database proves this stage is done
 *   false — the database proves it is not
 *   null  — this stage happens outside the product; only the tick can say
 */
export interface OnboardingStageStatus {
  stage: OnboardingStageName;
  label: string;
  /** A platform operator marked it complete. */
  completed: boolean;
  completedAt: Date | null;
  completedBy: string | null;
  note: string | null;
  /** What the data says, or null when the stage is unobservable. */
  evidence: boolean | null;
  /** Why `evidence` is what it is. Shown to the operator, never parsed. */
  evidenceDetail: string;
}

export interface OnboardingProgress {
  stages: OnboardingStageStatus[];
  /** Stages ticked, out of the twelve §49.1 defines. */
  completedCount: number;
  totalCount: number;
  /**
   * Every observable stage is satisfied by the data.
   *
   * Deliberately NOT "all twelve ticked": readiness is about the university
   * being usable, and Training or UAT being unticked does not make a
   * configured tenant unusable. What it does mean is stated on the screen.
   */
  dataReady: boolean;
}

/** The facts the checklist is derived from. One read, not one per stage. */
interface TenantFacts {
  hasVerifiedDomain: boolean;
  hasBranding: boolean;
  hasModuleSelection: boolean;
  hasAcademicYear: boolean;
  hasAdmin: boolean;
  isActive: boolean;
}

/**
 * Gather every fact the checklist needs, in one round trip.
 *
 * Counted rather than fetched: the checklist asks "is there at least one", and
 * pulling the rows to call .length on them would move data across the wire for
 * a question the database can answer with an index.
 */
async function readFacts(tenantId: string): Promise<TenantFacts | null> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      status: true,
      logoUrl: true,
      primaryColor: true,
      _count: {
        select: {
          // Only a VERIFIED, ACTIVE domain resolves — see lib/services/tenant.ts.
          // Counting every Domain row would tick the stage for a hostname that
          // does not work.
          domains: { where: { verified: true, isActive: true } },
          academicYears: true,
        },
      },
      subscriptions: { select: { features: true }, take: 1 },
    },
  });

  if (!tenant) return null;

  // PRD §5.1 "Assign enabled modules", against the §57 catalogue.
  //
  // Counts only keys the catalogue recognises, so the junk that predates the
  // catalogue cannot satisfy the checklist. A real tenant carries
  // `{"jhjj": true}`; before this was catalogue-aware that alone reported
  // "modules configured", which is exactly the false green the checklist exists
  // to prevent.
  //
  // At least one module must be ENABLED, not merely present: a map of every
  // module set to false is a decision that has been recorded, but it is not a
  // university that can do anything.
  const { modules } = partitionFeatures(
    tenant.subscriptions[0]?.features as Record<string, unknown> | null
  );
  const hasModuleSelection = Object.values(modules).some(Boolean);

  // Scoped by the role NAME, matching how requireRole and W1.4 provisioning
  // both identify a university administrator.
  const adminCount = await prisma.user.count({
    where: { tenantId, userRoles: { some: { role: { name: "UNIVERSITY_ADMIN", tenantId } } } },
  });

  return {
    hasVerifiedDomain: tenant._count.domains > 0,
    // Logo or primary colour. §5.1 says "logo and branding" without saying
    // which is mandatory, so either counts as configured.
    hasBranding: Boolean(tenant.logoUrl) || Boolean(tenant.primaryColor),
    hasModuleSelection,
    hasAcademicYear: tenant._count.academicYears > 0,
    hasAdmin: adminCount > 0,
    isActive: tenant.status === "ACTIVE",
  };
}

/** Evidence for each §49.1 stage, or null where the product cannot observe it. */
function evidenceFor(
  stage: OnboardingStageName,
  facts: TenantFacts
): { evidence: boolean | null; detail: string } {
  switch (stage) {
    // Pre-product stages. They happen in a sales conversation, and no query can
    // see them — a proxy signal here would be invented, not derived.
    case "UNIVERSITY_ENQUIRY":
    case "COMMERCIAL_APPROVAL":
      return { evidence: null, detail: "Recorded manually — happens before the tenant exists." };

    case "TENANT_CREATION":
      // Reached this function at all, so the tenant is there.
      return { evidence: true, detail: "Tenant exists." };

    case "DOMAIN_CONFIGURATION":
      return facts.hasVerifiedDomain
        ? { evidence: true, detail: "A verified, active domain resolves to this university." }
        : {
            evidence: false,
            detail:
              "No verified active domain. The university is still reachable at its platform subdomain.",
          };

    case "BRANDING_CONFIGURATION":
      return facts.hasBranding
        ? { evidence: true, detail: "Logo or primary colour is set." }
        : { evidence: false, detail: "No logo and no primary colour set." };

    case "MODULE_SELECTION":
      return facts.hasModuleSelection
        ? { evidence: true, detail: "At least one catalogue module is enabled on the subscription." }
        : {
            evidence: false,
            detail: "No modules from the PRD catalogue are enabled on the subscription.",
          };

    case "ACADEMIC_SETUP":
      return facts.hasAcademicYear
        ? { evidence: true, detail: "At least one academic year is configured." }
        : { evidence: false, detail: "No academic year configured." };

    case "DATA_IMPORT":
      // PRD §54 defines the migration modules and §55 Stage 3 the process, but
      // the import itself is W1.6. Claiming evidence from an importer that does
      // not exist would be the worst kind of green tick.
      return { evidence: null, detail: "Recorded manually — bulk import is not built yet (W1.6)." };

    case "USER_CREATION":
      return facts.hasAdmin
        ? { evidence: true, detail: "The university has at least one administrator." }
        : { evidence: false, detail: "No administrator — nobody can sign in to this university." };

    case "TRAINING":
    case "UAT":
      return { evidence: null, detail: "Recorded manually — carried out with the university." };

    case "GO_LIVE":
      return facts.isActive
        ? { evidence: true, detail: "Status is ACTIVE — staff and students can sign in." }
        : { evidence: false, detail: "Status is not ACTIVE — nobody can sign in." };
  }
}

/**
 * The full onboarding picture for one university.
 *
 * Returns null when the tenant does not exist, so the route can answer 404
 * rather than an empty checklist that looks like a brand-new university.
 */
export async function getOnboardingProgress(
  tenantId: string
): Promise<OnboardingProgress | null> {
  const facts = await readFacts(tenantId);
  if (!facts) return null;

  const steps = await prisma.tenantOnboardingStep.findMany({ where: { tenantId } });
  const byStage = new Map(steps.map((s) => [s.stage as OnboardingStageName, s]));

  const stages: OnboardingStageStatus[] = ONBOARDING_STAGES.map((stage) => {
    const step = byStage.get(stage);
    const { evidence, detail } = evidenceFor(stage, facts);

    return {
      stage,
      label: STAGE_LABELS[stage],
      completed: Boolean(step),
      completedAt: step?.completedAt ?? null,
      completedBy: step?.completedBy ?? null,
      note: step?.note ?? null,
      evidence,
      evidenceDetail: detail,
    };
  });

  return {
    stages,
    completedCount: stages.filter((s) => s.completed).length,
    totalCount: stages.length,
    dataReady: stages.every((s) => s.evidence !== false),
  };
}

/**
 * Mark a §49.1 stage complete.
 *
 * Idempotent by upsert over the composite primary key, so marking twice is not
 * an error and a double-clicked button cannot 409. Re-marking refreshes the
 * note and the operator, which is what "I have re-checked this" means.
 *
 * The stage is NOT validated against an order. §49.1's arrows are the intended
 * sequence, not a lock — real onboarding runs training and data import in
 * parallel, and refusing an out-of-order tick would make the checklist lie
 * about work that genuinely happened.
 */
export async function markOnboardingStage(
  tenantId: string,
  stage: OnboardingStageName,
  completedBy: string,
  note?: string
): Promise<boolean> {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
  if (!tenant) return false;

  await prisma.tenantOnboardingStep.upsert({
    where: { tenantId_stage: { tenantId, stage: stage as OnboardingStage } },
    update: { completedBy, note: note ?? null, completedAt: new Date() },
    create: { tenantId, stage: stage as OnboardingStage, completedBy, note: note ?? null },
  });

  return true;
}

/**
 * Un-mark a stage.
 *
 * deleteMany rather than delete: removing a tick that is already absent is the
 * outcome the caller wanted, not a P2025 to translate into a 404.
 */
export async function clearOnboardingStage(
  tenantId: string,
  stage: OnboardingStageName
): Promise<void> {
  await prisma.tenantOnboardingStep.deleteMany({
    where: { tenantId, stage: stage as OnboardingStage },
  });
}
