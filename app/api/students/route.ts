// ============================================================================
// OWNER  : Gauransh
// MODULE : Students — Student Collection
// FLOW   : Guard → tenant → query/body → parallel ownership and existence
//          checks → duplicate checks → create → response.
// ACCESS : UNIVERSITY_ADMIN
// BACKEND: Prisma
// PURPOSE: List and enrol students within the authenticated tenant.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { requireModule } from "@/lib/middleware/requireModule";
import {
  programmeIdsForDepartment,
  resolveDepartmentScope,
} from "@/lib/auth/departmentScope";
import { STUDENT_READ_ROLES } from "@/lib/constants/departmentAcademics";
import { isForeignKeyViolation } from "@/lib/utils/prisma-errors";
import { createStudentSchema, listStudentsQuerySchema } from "@/lib/validations/student";
import { generateIdentifier } from "@/lib/services/identifier.service";
import { recordAudit } from "@/lib/services/audit.service";
import { readRequestOrigin } from "@/lib/utils/requestOrigin";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/constants/audit";
import { ok, fail } from "@/types";
import { validationDetails } from "@/lib/utils/validation-error";
// PHASE 27 administration event "New Admission". Emitted after commit.
import {
  findAdminUserIds,
  notificationEmitter,
  notifyAfterCommit,
} from "@/lib/controllers/notificationEmitter.controller";

/** Prisma's unique-constraint violation code. */
const UNIQUE_VIOLATION = "P2002";

/**
 * Columns returned for a student. Declared once so both handlers answer with
 * the same shape.
 *
 * Student carries no credential or otherwise sensitive column of its own, but
 * the select is explicit for the same reason it is everywhere else in this
 * project: it fixes the response contract rather than letting it track whatever
 * the model happens to contain. No relation is expanded — the linked User, and
 * therefore the student's name and email, is reached through
 * GET /api/students/[id] rather than being joined into every list row.
 */
const STUDENT_SELECT = {
  id: true,
  tenantId: true,
  userId: true,
  enrollmentNo: true,
  programmeId: true,
  batchId: true,
  sectionId: true,
  specialisationId: true,
  currentSemester: true,
  status: true,
  admissionDate: true,
  graduationDate: true,
  createdAt: true,
  updatedAt: true,
} as const;

/**
 * The listing's select: every Student column above, plus the linked User.
 *
 * WHY THE LIST JOINS AND THE CREATE DOES NOT
 *   A Student carries no name — it lives on the User the record points at. The
 *   list screen renders that name and its search box says "Search by name or
 *   enrolment number", so the list has to return it. POST keeps STUDENT_SELECT
 *   unchanged: nothing consumes a name from a create response, and widening it
 *   would be a contract change nothing asked for.
 *
 * EXACTLY THE FIVE FIELDS StudentWithUser DECLARES
 *   `Pick<User, "id" | "firstName" | "lastName" | "email" | "avatarUrl">` — see
 *   types/entities.ts. phone, displayName, isActive, isVerified and passwordHash
 *   are NOT selected: an explicit column list is what keeps a future column off
 *   this response by default rather than by somebody remembering to exclude it.
 */
const STUDENT_LIST_SELECT = {
  ...STUDENT_SELECT,
  user: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      avatarUrl: true,
    },
  },
} as const;

// Student holds no BigInt, Decimal or Json column, so the shared serialize()
// helper is not applied here.

// GET
// ACCESS     : UNIVERSITY_ADMIN
// VALIDATION : listStudentsQuerySchema — ?page (default 1) and ?limit (default
//              20, max 100) from the shared pagination contract, plus the four
//              parameters this screen's controls send: ?q, ?status,
//              ?programmeId and ?batchId. Each is optional, and an empty value
//              means "no filter" rather than an invalid enum member.
// FLOW       : Authorise → resolve tenant → read one page of that tenant's
//              students, joined to the linked User for the name, alongside the
//              total in a single transaction.
//              Both queries are filtered by the tenant id that requireTenant
//              proved equal to the caller's own, so no cross-tenant row is
//              reachable.
// RESPONSE   : { success: true, data: { students, pagination } }, where each
//              student carries `user` — id, firstName, lastName, email and
//              avatarUrl, and nothing else.
// STATUS     : 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 404 NOT_FOUND · 500 SERVER_ERROR
export async function GET(request: NextRequest) {
  try {
    // A head of department reads their own department's students. The role
    // check admits them; the scope below is what narrows the rows.
    const guard = await requireRole(...STUDENT_READ_ROLES);
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    // GAP-01 — the tenant's module selection, applied AFTER role and
    // tenant so a 403 here can only ever describe the caller's own
    // university. Ungoverned paths cost no query.
    const moduleGuard = await requireModule(tenantGuard.tenant.id, request.nextUrl.pathname);
    if (!moduleGuard.allowed) return moduleGuard.response;

    const { tenant } = tenantGuard;

    const parsed = listStudentsQuerySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams)
    );
    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false as const,
          error: "Invalid input",
          code: "VALIDATION_ERROR",
          details: validationDetails(parsed.error),
        },
        { status: 400 }
      );
    }

    const { page, limit, q, status, programmeId, batchId } = parsed.data;

    // The tenant predicate is never optional and never overridable: it comes
    // from requireTenant, and every filter is composed INSIDE it. So no value
    // of ?q, ?status, ?programmeId or ?batchId can reach another institution's
    // students — an id naming another tenant's batch simply matches nothing.
    //
    // The name is NOT a column on Student; it lives on the User the record
    // points at, which is why ?q reaches through the `user` relation. Those
    // nested predicates are still ANDed under tenantId, so they cannot widen
    // the set beyond this tenant.
    //
    // WHY THE TERM IS SPLIT ON WHITESPACE
    //   There is no full-name column — only firstName and lastName — and Prisma
    //   cannot concatenate two columns inside a `where`. A plain OR over the two
    //   therefore matches "Priya" and matches "Sharma" but NEVER matches "Priya
    //   Sharma" typed in full, which is the most natural thing to type into a
    //   box labelled "Search by name". types/entities.ts records that exact
    //   trap on StudentWithUser.fullName.
    //
    //   So every whitespace-separated term must match SOMEWHERE: "Priya Sharma"
    //   succeeds because "Priya" hits firstName and "Sharma" hits lastName, and
    //   it succeeds whichever order they are typed in. A single term behaves
    //   exactly as the plain OR did. "priya zzz" correctly matches nothing.
    //
    //   This uses only the columns the schema already has. Concatenating them
    //   would need raw SQL or a denormalised column, and neither is warranted
    //   for a search box.
    //
    // `mode: "insensitive"` is what makes "PRIYA", "Priya" and "priya" one
    // search; `contains` is what makes "pri" match "Priya" rather than only a
    // name equal to it.
    //
    // An omitted filter contributes NOTHING to the predicate, which is exactly
    // what "All statuses", "All programmes" and "All batches" mean.
    const terms = q ? q.split(/\s+/).filter(Boolean) : [];

    // The department restriction, derived from the authenticated identity.
    const scope = await resolveDepartmentScope(guard.session);
    if (!scope.ok) return scope.response;

    // Student carries no departmentId — it points at a Programme, and the
    // Programme belongs to a Department. Student.programmeId is also a plain
    // scalar with NO Prisma relation, so a nested `where` is not expressible;
    // the department's programmes are resolved first and applied with `in`.
    //
    // An EMPTY array is applied, not skipped. A department with no programmes
    // has no students, and `in: []` matches nothing — which is the correct
    // answer. Treating it as "no filter" would hand that head the university.
    //
    // A student with a null programmeId is invisible to a head, for the same
    // reason an unowned course is: nobody has placed them in this department.
    const departmentProgrammeIds = scope.scope.restricted
      ? await programmeIdsForDepartment(tenant.id, scope.scope.departmentId)
      : null;

    // THE DEPARTMENT RESTRICTION AND THE ?programmeId FILTER CONSTRAIN THE SAME
    // COLUMN, SO THEY ARE COMBINED INTO ONE CONDITION — NOT SPREAD SEPARATELY.
    //   Two object spreads both setting `programmeId` do not intersect; the
    //   later one silently REPLACES the earlier. With the caller's filter
    //   spread last, a head passing another department's programme id would
    //   overwrite their own restriction and read that department's students.
    //   Combining them here is what makes the restriction unconditional.
    //
    // Restricted + a requested programme -> the intersection, so a programme
    // the department does not own yields `in: []` and matches nothing.
    // Restricted + no request            -> every programme the department owns.
    // Unrestricted                       -> the caller's filter, unchanged.
    const programmeWhere: Prisma.StudentWhereInput =
      departmentProgrammeIds !== null
        ? {
            programmeId: {
              in: programmeId
                ? departmentProgrammeIds.filter((id) => id === programmeId)
                : departmentProgrammeIds,
            },
          }
        : programmeId
          ? { programmeId }
          : {};

    const where: Prisma.StudentWhereInput = {
      tenantId: tenant.id,
      ...programmeWhere,
      ...(terms.length > 0
        ? {
            AND: terms.map((term) => ({
              OR: [
                { enrollmentNo: { contains: term, mode: "insensitive" as const } },
                { user: { firstName: { contains: term, mode: "insensitive" as const } } },
                { user: { lastName: { contains: term, mode: "insensitive" as const } } },
                { user: { email: { contains: term, mode: "insensitive" as const } } },
              ],
            })),
          }
        : {}),
      ...(status ? { status } : {}),
      // programmeId is NOT spread here — it is folded into programmeWhere
      // above, together with the department restriction. See the note there.
      ...(batchId ? { batchId } : {}),
    };

    // Paired in one transaction so the total cannot shift between the two
    // reads. The ordering is required for correctness, not presentation:
    // offset pagination over an unordered result can repeat or skip rows, and
    // the id tiebreaker matters because students admitted in the same batch can
    // share a createdAt timestamp, leaving createdAt alone non-deterministic.
    const [students, total] = await prisma.$transaction([
      prisma.student.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * limit,
        take: limit,
        // The listing select — Student columns plus the five User fields the
        // StudentWithUser contract declares. POST below keeps STUDENT_SELECT.
        select: STUDENT_LIST_SELECT,
      }),
      prisma.student.count({ where }),
    ]);

    return NextResponse.json(
      ok({
        students,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      })
    );
  } catch (err) {
    console.error("[GET /api/students]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

// POST
// ACCESS     : UNIVERSITY_ADMIN
// VALIDATION : createStudentSchema — userId, enrollmentNo and admissionDate
//              required; the rest optional. tenantId, id, createdAt and
//              updatedAt are absent from the schema and so are stripped from
//              any body that supplies them.
// FLOW       : Authorise → resolve tenant → parse body → run seven independent
//              lookups together → apply them in a fixed precedence → create.
//
//              Every reference is verified against this tenant, not merely for
//              existence. The database's foreign keys cannot do that: they
//              confirm only that a row exists, so without these checks a caller
//              could enrol a student against another university's batch,
//              section or specialisation.
//
//              programmeId is the case that matters most. Student.programmeId
//              carries no relation and no foreign key in the schema — it is a
//              bare String column — so the database will accept any value at
//              all, including another tenant's programme id or arbitrary text.
//              For every other reference the lookup here is defence in depth
//              over a constraint; for this one it is the only check that exists
//              anywhere, on create and on update alike.
//
//              Two uniqueness rules apply: Student.userId is @unique globally,
//              so a user may hold at most one student record, and
//              @@unique([tenantId, enrollmentNo]) makes an enrolment number
//              unique within the tenant while allowing the same number under a
//              different tenant.
// RESPONSE   : { success: true, data: <Student>, message: "Student created" }
// STATUS     : 201 Created · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 404 NOT_FOUND · 409 CONFLICT · 500 SERVER_ERROR
export async function POST(request: NextRequest) {
  try {
    const guard = await requireRole("UNIVERSITY_ADMIN");
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    // GAP-01 — the tenant's module selection, applied AFTER role and
    // tenant so a 403 here can only ever describe the caller's own
    // university. Ungoverned paths cost no query.
    const moduleGuard = await requireModule(tenantGuard.tenant.id, request.nextUrl.pathname);
    if (!moduleGuard.allowed) return moduleGuard.response;

    const { tenant } = tenantGuard;

    // A malformed body is a client error, so it is caught here rather than
    // being allowed to fall through to the 500 handler below.
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(fail("Invalid input", "VALIDATION_ERROR"), { status: 400 });
    }

    const parsed = createStudentSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false as const,
          error: "Invalid input",
          code: "VALIDATION_ERROR",
          details: validationDetails(parsed.error),
        },
        { status: 400 }
      );
    }

    const input = parsed.data;

    // Seven independent reads, so they are issued together rather than in
    // sequence. Each optional reference is skipped entirely when its id was not
    // supplied, so an omitted field costs no query.
    const [
      user,
      studentForUser,
      duplicateEnrollment,
      programme,
      batch,
      section,
      specialisation,
    ] = await Promise.all([
      prisma.user.findFirst({
        where: { id: input.userId, tenantId: tenant.id },
        select: { id: true },
      }),
      prisma.student.findUnique({
        where: { userId: input.userId },
        select: { id: true },
      }),
      // Nothing to pre-check when the engine will issue it: a generated value
      // is unique by construction, and the unique index remains the real guard
      // either way.
      input.enrollmentNo === undefined
        ? Promise.resolve(null)
        : prisma.student.findUnique({
            where: {
              tenantId_enrollmentNo: { tenantId: tenant.id, enrollmentNo: input.enrollmentNo },
            },
            select: { id: true },
          }),
      input.programmeId === undefined
        ? Promise.resolve(null)
        : prisma.programme.findFirst({
            where: { id: input.programmeId, tenantId: tenant.id },
            select: { id: true },
          }),
      input.batchId === undefined
        ? Promise.resolve(null)
        : prisma.batch.findFirst({
            where: { id: input.batchId, tenantId: tenant.id },
            select: { id: true },
          }),
      input.sectionId === undefined
        ? Promise.resolve(null)
        : prisma.section.findFirst({
            where: { id: input.sectionId, tenantId: tenant.id },
            select: { id: true },
          }),
      input.specialisationId === undefined
        ? Promise.resolve(null)
        : prisma.specialisation.findFirst({
            where: { id: input.specialisationId, tenantId: tenant.id },
            select: { id: true },
          }),
    ]);

    // Precedence is fixed so the reported error does not depend on which query
    // resolved first: invalid references before constraint clashes, and the
    // user before the academic references since it is the student's identity.
    if (!user) {
      return NextResponse.json(fail("User not found", "NOT_FOUND"), { status: 404 });
    }

    if (input.programmeId !== undefined && !programme) {
      return NextResponse.json(fail("Programme not found", "NOT_FOUND"), { status: 404 });
    }

    if (input.batchId !== undefined && !batch) {
      return NextResponse.json(fail("Batch not found", "NOT_FOUND"), { status: 404 });
    }

    if (input.sectionId !== undefined && !section) {
      return NextResponse.json(fail("Section not found", "NOT_FOUND"), { status: 404 });
    }

    if (input.specialisationId !== undefined && !specialisation) {
      return NextResponse.json(fail("Specialisation not found", "NOT_FOUND"), { status: 404 });
    }

    if (studentForUser) {
      return NextResponse.json(
        fail("User is already linked to a student", "CONFLICT"),
        { status: 409 }
      );
    }

    if (duplicateEnrollment) {
      return NextResponse.json(
        fail("Enrollment number already in use", "CONFLICT"),
        { status: 409 }
      );
    }

    // Single write — already atomic, so no transaction is warranted. tenantId
    // comes from the resolved tenant context, never from the request body.
        // PRD §9 — the identifier engine issues enrollmentNo when the caller omits it.
    //
    // The field stays OPTIONAL rather than becoming generated-only: an
    // institution that has not configured a sequence must keep working exactly
    // as before, and a migration importing legacy records must be able to carry
    // their existing numbers across. A supplied value always wins, so this is a
    // widening of the contract and breaks no existing client.
    //
    // Generation happens INSIDE the transaction that creates the row, so a
    // failed create rolls the counter back with it and leaves no gap.
    // One actor for every entry this request writes, so the identifier issue
    // and the record creation are findable together.
    const actor = {
      userId: guard.session.sub,
      ...readRequestOrigin(request.headers),
    };

    const student = await prisma.$transaction(async (tx) => {
      const enrollmentNo =
        input.enrollmentNo ??
        (await generateIdentifier(
          { tenantId: tenant.id, entityType: "STUDENT", actor },
          tx
        ));

      const created = await tx.student.create({
        data: {
          ...input,
          enrollmentNo,
          tenantId: tenant.id,
        },
        select: STUDENT_SELECT,
      });

      // PRD §47 "Data change logs". Same transaction as the row it describes,
      // so evidence and record commit or roll back together.
      await recordAudit(
        {
          tenantId: tenant.id,
          actor,
          action: AUDIT_ACTIONS.STUDENT_CREATED,
          resource: AUDIT_RESOURCES.STUDENT,
          resourceId: created.id,
          // The identifier and the linked user, not the whole record. A
          // creation snapshot of every column would copy personal data into a
          // second table for no investigative gain.
          after: { enrollmentNo, userId: created.userId },
        },
        tx
      );

      return created;
    });

        // PHASE 27 administration event "New Admission".
    //
    // After the student row exists, throwing nothing. Addressed to the tenant's
    // administrators, resolved by ROLE NAME through UserRole — the same stable
    // identifier requireRole itself compares on.
    await notifyAfterCommit("POST /api/students", async () => {
      await notificationEmitter.newAdmission({
        tenantId: tenant.id,
        recipientUserIds: await findAdminUserIds(tenant.id),
        studentName: student.enrollmentNo,
        enrollmentNo: student.enrollmentNo,
        studentId: student.id,
      });
    });

    return NextResponse.json(ok(student, "Student created"), { status: 201 });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      // A concurrent request took the enrolment number or the user between the
      // checks and the insert. Which of the two unique constraints was violated
      // is not reliably recoverable from the error under the driver adapter, so
      // both are reported together rather than guessed at.
      if (err.code === UNIQUE_VIOLATION) {
        return NextResponse.json(
          fail("Enrollment number or user already in use", "CONFLICT"),
          { status: 409 }
        );
      }
      // The user, batch, section or specialisation was deleted between its
      // check and the insert, so the foreign key rejected the reference. Note
      // that programmeId cannot appear here: it has no foreign key, so a
      // programme deleted in that window leaves a dangling id rather than
      // raising anything.
      if (isForeignKeyViolation(err)) {
        return NextResponse.json(
          fail("Referenced user, batch, section or specialisation not found", "NOT_FOUND"),
          { status: 404 }
        );
      }
    }

    console.error("[POST /api/students]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}
