// ============================================================================
// OWNER  : Gauransh
// MODULE : Admissions (W3 — PRD §8.2, §8.5, §9.1, §49.2)
// LAYER  : Service — the only module that writes Application, and the only one
//          that converts an application into a Student.
// ACCESS : Called from routes that have already authorised the caller.
//
// THE STAGE MACHINE IS SEQUENTIAL, AND THAT IS A RECORDED CHOICE
//   §49.2 gives an ordered chain and says nothing about skipping, reversing or
//   branching. Rather than invent a state machine, transitions advance by
//   EXACTLY ONE stage. It is the simplest rule that cannot silently lose a
//   step, and the ambiguity is recorded in TECHNICAL_DEBT.md instead of being
//   resolved by guesswork.
//
// IDENTIFIERS COME FROM THE EXISTING ENGINE, INSIDE THE TRANSACTION
//   PRD §9.1 names "Applicant ID" and "Application number"; both are issued by
//   generateIdentifier, which locks its counter. Called inside the same
//   transaction as the insert, so a failed insert cannot consume a number, and
//   two concurrent creations cannot receive the same one.
//
// CONVERSION IS ALL-OR-NOTHING
//   §8.5 creates a User, a Student, an enrolment number and a role grant. A
//   partial conversion leaves an account that cannot be used or a student with
//   no login, so every write is in one transaction and Application.studentId is
//   @unique — the database, not a service check, is what makes a second
//   conversion impossible.
// ============================================================================

import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { generateIdentifier } from "@/lib/services/identifier.service";
import { hashPassword } from "@/lib/auth/password";
import { generateTemporaryPassword } from "@/lib/services/platformUser.service";
import {
  ADMISSION_STAGES,
  type AdmissionStageName,
  type ConvertApplicationInput,
  type CreateApplicationInput,
  type ListApplicationsQuery,
  type UpdateApplicationInput,
} from "@/lib/validations/admission";

/** Columns an application is ever exposed through. */
const APPLICATION_SELECT = {
  id: true,
  tenantId: true,
  applicantNo: true,
  applicationNo: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  dateOfBirth: true,
  guardianName: true,
  guardianRelation: true,
  guardianPhone: true,
  guardianEmail: true,
  educationHistory: true,
  workHistory: true,
  stage: true,
  studentId: true,
  convertedAt: true,
  createdAt: true,
  updatedAt: true,
  preferences: {
    select: {
      priority: true,
      programme: { select: { id: true, code: true, name: true } },
    },
    orderBy: { priority: "asc" },
  },
} as const;

export type AdmissionError =
  | "NOT_FOUND"
  | "EMAIL_TAKEN"
  | "NO_SEQUENCE"
  | "INVALID_TRANSITION"
  | "ALREADY_CONVERTED"
  | "NOT_READY_TO_CONVERT"
  | "PROGRAMME_NOT_FOUND"
  | "BATCH_NOT_FOUND"
  | "STUDENT_EMAIL_TAKEN";

export type AdmissionResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: AdmissionError; detail?: string };

/** Prisma's unique-constraint violation code. */
const UNIQUE_VIOLATION = "P2002";

/** The stage that follows `from`, or null when it is the last one. */
export function nextStage(from: AdmissionStageName): AdmissionStageName | null {
  const index = ADMISSION_STAGES.indexOf(from);
  return index >= 0 && index < ADMISSION_STAGES.length - 1
    ? ADMISSION_STAGES[index + 1]
    : null;
}

/**
 * Create an application (PRD §8.2).
 *
 * Both identifiers are issued inside the transaction. If the tenant has no
 * configured sequence for either, generateIdentifier throws and the whole
 * creation fails with NO_SEQUENCE — no default format is invented, and no
 * application is stored without a number.
 */
export async function createApplication(
  tenantId: string,
  input: CreateApplicationInput
): Promise<AdmissionResult<{ id: string }>> {
  const { preferences, ...scalars } = input;

  // §8.3 "Duplicate application detection", in the terms this model has: one
  // address applying twice to one university. Pre-checked for a readable error;
  // the unique index below is the actual guarantee.
  const existing = await prisma.application.findUnique({
    where: { tenantId_email: { tenantId, email: scalars.email } },
    select: { id: true },
  });
  if (existing) return { ok: false, error: "EMAIL_TAKEN" };

  if (preferences?.length) {
    const found = await prisma.programme.count({
      where: { tenantId, id: { in: preferences.map((p) => p.programmeId) } },
    });
    // Scoped by tenant, so a programme id from another university is reported
    // as absent rather than silently attached.
    if (found !== preferences.length) return { ok: false, error: "PROGRAMME_NOT_FOUND" };
  }

  try {
    const created = await prisma.$transaction(async (tx) => {
      const [applicantNo, applicationNo] = [
        await generateIdentifier({ tenantId, entityType: "APPLICANT" }, tx),
        await generateIdentifier({ tenantId, entityType: "APPLICATION" }, tx),
      ];

      return tx.application.create({
        data: {
          tenantId,
          applicantNo,
          applicationNo,
          ...scalars,
          educationHistory: scalars.educationHistory as Prisma.InputJsonValue | undefined,
          workHistory: scalars.workHistory as Prisma.InputJsonValue | undefined,
          preferences: preferences?.length
            ? { create: preferences.map((p) => ({ programmeId: p.programmeId, priority: p.priority })) }
            : undefined,
        },
        select: { id: true },
      });
    });

    return { ok: true, value: created };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === UNIQUE_VIOLATION) {
      return { ok: false, error: "EMAIL_TAKEN" };
    }
    // generateIdentifier refuses when no active sequence is configured. Surfaced
    // honestly rather than falling back to a made-up format.
    if (err instanceof Error && /identifier sequence/i.test(err.message)) {
      return { ok: false, error: "NO_SEQUENCE", detail: err.message };
    }
    throw err;
  }
}

/** One page of applications, with the same filter applied to the count. */
export async function listApplications(tenantId: string, query: ListApplicationsQuery) {
  const { page, limit, stage, q } = query;

  const where: Prisma.ApplicationWhereInput = {
    tenantId,
    ...(stage ? { stage } : {}),
    ...(q
      ? {
          OR: [
            { firstName: { contains: q, mode: "insensitive" as const } },
            { lastName: { contains: q, mode: "insensitive" as const } },
            { email: { contains: q, mode: "insensitive" as const } },
            { applicationNo: { contains: q, mode: "insensitive" as const } },
            { applicantNo: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [applications, total] = await prisma.$transaction([
    prisma.application.findMany({
      where,
      select: APPLICATION_SELECT,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.application.count({ where }),
  ]);

  return { applications, total };
}

/** One application, scoped by tenant so another university's is simply absent. */
export async function getApplication(tenantId: string, applicationId: string) {
  return prisma.application.findFirst({
    where: { id: applicationId, tenantId },
    select: APPLICATION_SELECT,
  });
}

/**
 * Update editable application data.
 *
 * Stage, both identifiers, studentId and tenantId are not in the input type and
 * are not written here. Preferences are REPLACED when supplied — a preference
 * list is an ordered whole, and merging two partial lists produces an order
 * nobody chose.
 */
export async function updateApplication(
  tenantId: string,
  applicationId: string,
  input: UpdateApplicationInput
): Promise<AdmissionResult<{ id: string }>> {
  const existing = await prisma.application.findFirst({
    where: { id: applicationId, tenantId },
    select: { id: true, convertedAt: true },
  });
  if (!existing) return { ok: false, error: "NOT_FOUND" };

  const { preferences, ...scalars } = input;

  if (preferences?.length) {
    const found = await prisma.programme.count({
      where: { tenantId, id: { in: preferences.map((p) => p.programmeId) } },
    });
    if (found !== preferences.length) return { ok: false, error: "PROGRAMME_NOT_FOUND" };
  }

  try {
    await prisma.$transaction(async (tx) => {
      if (preferences) {
        await tx.applicationPreference.deleteMany({ where: { applicationId } });
        if (preferences.length) {
          await tx.applicationPreference.createMany({
            data: preferences.map((p) => ({
              applicationId,
              programmeId: p.programmeId,
              priority: p.priority,
            })),
          });
        }
      }

      await tx.application.update({
        where: { id: applicationId },
        data: {
          ...scalars,
          educationHistory: scalars.educationHistory as Prisma.InputJsonValue | undefined,
          workHistory: scalars.workHistory as Prisma.InputJsonValue | undefined,
        },
      });
    });

    return { ok: true, value: { id: applicationId } };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === UNIQUE_VIOLATION) {
      return { ok: false, error: "EMAIL_TAKEN" };
    }
    throw err;
  }
}

/**
 * Advance one stage along PRD §49.2.
 *
 * Refuses anything that is not exactly the next stage — including the current
 * one, which makes a double-submitted request a no-op error rather than a
 * silent second advance. Skipping and reversing are both refused; see the
 * module header for why that is the chosen reading.
 */
export async function advanceStage(
  tenantId: string,
  applicationId: string,
  toStage: AdmissionStageName
): Promise<AdmissionResult<{ from: AdmissionStageName; to: AdmissionStageName }>> {
  const existing = await prisma.application.findFirst({
    where: { id: applicationId, tenantId },
    select: { id: true, stage: true },
  });
  if (!existing) return { ok: false, error: "NOT_FOUND" };

  const from = existing.stage as AdmissionStageName;
  const expected = nextStage(from);

  if (expected === null) {
    return {
      ok: false,
      error: "INVALID_TRANSITION",
      detail: `${from} is the final stage.`,
    };
  }

  if (toStage !== expected) {
    return {
      ok: false,
      error: "INVALID_TRANSITION",
      detail: `An application at ${from} may only move to ${expected}.`,
    };
  }

  // Conditioned on the stage it was read at, so a concurrent transition cannot
  // advance twice — the second update matches no row.
  const updated = await prisma.application.updateMany({
    where: { id: applicationId, tenantId, stage: from },
    data: { stage: toStage },
  });

  if (updated.count === 0) {
    return {
      ok: false,
      error: "INVALID_TRANSITION",
      detail: "The application moved while this request was in flight.",
    };
  }

  return { ok: true, value: { from, to: toStage } };
}

/**
 * PRD §8.5 — convert an admitted application into a Student.
 *
 * WHAT §8.5 DEFINES AND THIS DOES
 *   "Creates student profile", "Generates student ID", "Generates enrolment
 *   number", "Assigns programme and batch", "Creates portal credentials".
 *
 * WHAT §8.5 NAMES AND THIS DELIBERATELY DOES NOT DO
 *   Assign courses, generate a fee plan, assign a mentor, assign hostel and
 *   transport, generate a digital ID card, create a university email, send
 *   onboarding communication. Each names a capability with no rule, no model or
 *   no transport behind it. Recorded as gaps rather than guessed at.
 *
 * WHEN IT MAY RUN
 *   Only at STUDENT_ID_GENERATION or later — that is the §49.2 stage at which
 *   the workflow says a student identity comes into existence. Earlier is
 *   refused, so an application cannot become a student before it has been
 *   selected and offered.
 */
export async function convertToStudent(
  tenantId: string,
  applicationId: string,
  input: ConvertApplicationInput
): Promise<
  AdmissionResult<{ studentId: string; enrollmentNo: string; email: string; temporaryPassword: string }>
> {
  const application = await prisma.application.findFirst({
    where: { id: applicationId, tenantId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      stage: true,
      studentId: true,
    },
  });
  if (!application) return { ok: false, error: "NOT_FOUND" };
  if (application.studentId) return { ok: false, error: "ALREADY_CONVERTED" };

  const reachedIdStage =
    ADMISSION_STAGES.indexOf(application.stage as AdmissionStageName) >=
    ADMISSION_STAGES.indexOf("STUDENT_ID_GENERATION");

  if (!reachedIdStage) {
    return {
      ok: false,
      error: "NOT_READY_TO_CONVERT",
      detail: `An application must reach Student ID Generation before conversion. It is at ${application.stage}.`,
    };
  }

  // Both scoped by tenant — an id from another university is absent, not found.
  const [programme, batch, emailClash] = await Promise.all([
    prisma.programme.findFirst({ where: { id: input.programmeId, tenantId }, select: { id: true } }),
    prisma.batch.findFirst({ where: { id: input.batchId, tenantId }, select: { id: true } }),
    prisma.user.findUnique({
      where: { tenantId_email: { tenantId, email: application.email } },
      select: { id: true },
    }),
  ]);

  if (!programme) return { ok: false, error: "PROGRAMME_NOT_FOUND" };
  if (!batch) return { ok: false, error: "BATCH_NOT_FOUND" };
  // The applicant's address already belongs to somebody at this university.
  if (emailClash) return { ok: false, error: "STUDENT_EMAIL_TAKEN" };

  // Generated before the transaction: bcrypt is ~520ms and holding a
  // transaction open for it would serialise every concurrent conversion.
  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);

  try {
    const result = await prisma.$transaction(async (tx) => {
      // The STUDENT role must already exist — import and provisioning follow the
      // same rule, and PRD §55 places role configuration before operations.
      const role = await tx.role.findUnique({
        where: { tenantId_name: { tenantId, name: "STUDENT" } },
        select: { id: true },
      });
      if (!role) throw new Error("NO_STUDENT_ROLE");

      const user = await tx.user.create({
        data: {
          tenantId,
          email: application.email,
          firstName: application.firstName,
          lastName: application.lastName,
          phone: application.phone,
          passwordHash,
          // W1.6's approved credential policy, reused unchanged.
          mustChangePassword: true,
          isActive: true,
        },
        select: { id: true },
      });

      await tx.userRole.create({ data: { userId: user.id, roleId: role.id } });

      // PRD §8.5 "Generates enrolment number" — the existing engine, never a
      // second numbering scheme.
      const enrollmentNo = await generateIdentifier({ tenantId, entityType: "STUDENT" }, tx);

      const student = await tx.student.create({
        data: {
          tenantId,
          userId: user.id,
          enrollmentNo,
          programmeId: input.programmeId,
          batchId: input.batchId,
          admissionDate: input.admissionDate ?? new Date(),
        },
        select: { id: true, enrollmentNo: true },
      });

      // @unique on Application.studentId — a concurrent second conversion fails
      // here rather than producing two students for one application.
      await tx.application.update({
        where: { id: applicationId },
        data: { studentId: student.id, convertedAt: new Date() },
      });

      return student;
    });

    return {
      ok: true,
      value: {
        studentId: result.id,
        enrollmentNo: result.enrollmentNo,
        email: application.email,
        temporaryPassword,
      },
    };
  } catch (err) {
    if (err instanceof Error && err.message === "NO_STUDENT_ROLE") {
      return {
        ok: false,
        error: "NOT_READY_TO_CONVERT",
        detail: "This university has no STUDENT role. Create it before converting applicants.",
      };
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === UNIQUE_VIOLATION) {
      return { ok: false, error: "ALREADY_CONVERTED" };
    }
    if (err instanceof Error && /identifier sequence/i.test(err.message)) {
      return { ok: false, error: "NO_SEQUENCE", detail: err.message };
    }
    throw err;
  }
}
