// ============================================================================
// OWNER  : Gauransh
// MODULE : University — Programme Specialisations
// FLOW   : List and create specialisations for a tenant-owned programme.
// ACCESS : UNIVERSITY_ADMIN
// BACKEND: Uses existing Prisma Specialisation model.
// PURPOSE: Manage programme specialisations within the authenticated tenant.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { isForeignKeyViolation } from "@/lib/utils/prisma-errors";
import { programmeIdParamSchema } from "@/lib/validations/programme";
import {
  createSpecialisationSchema,
  listSpecialisationsQuerySchema,
} from "@/lib/validations/specialisation";
import { ok, fail } from "@/types";
import { validationDetails } from "@/lib/utils/validation-error";

/** Prisma's unique-constraint violation code. */
const UNIQUE_VIOLATION = "P2002";

// Specialisation holds no BigInt, Decimal or Json column — only strings, a
// boolean and a timestamp — so neither the shared serialize() helper nor an
// InputJsonValue cast applies here. The schema is immutable, so that cannot
// change. Note also that this model carries createdAt but no updatedAt.

// The [id] segment is the PROGRAMME id, so the existing programme param schema
// is reused rather than a near-identical one being declared for this route.

// GET
// ACCESS     : UNIVERSITY_ADMIN
// VALIDATION : programmeIdParamSchema for the [id] segment,
//              listSpecialisationsQuerySchema for ?page and ?limit from the
//              shared pagination contract.
// FLOW       : Authorise → resolve tenant → confirm the programme exists AND
//              belongs to this tenant (404 for either, so a foreign programme
//              is indistinguishable from a nonexistent one) → read one page of
//              that programme's specialisations alongside the total in a single
//              transaction.
//              The parent check comes first: without it, an unknown programme
//              id would return an empty list rather than 404, silently implying
//              the programme exists but has no specialisations.
// RESPONSE   : { success: true, data: { specialisations, pagination } }
// STATUS     : 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 404 NOT_FOUND · 500 SERVER_ERROR
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const guard = await requireRole("UNIVERSITY_ADMIN");
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const { tenant } = tenantGuard;

    // Route params resolve asynchronously in this Next.js version.
    const parsedParams = programmeIdParamSchema.safeParse(await params);
    if (!parsedParams.success) {
      return NextResponse.json(
        {
          success: false as const,
          error: "Invalid input",
          code: "VALIDATION_ERROR",
          details: validationDetails(parsedParams.error),
        },
        { status: 400 }
      );
    }

    const parsedQuery = listSpecialisationsQuerySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams)
    );
    if (!parsedQuery.success) {
      return NextResponse.json(
        {
          success: false as const,
          error: "Invalid input",
          code: "VALIDATION_ERROR",
          details: validationDetails(parsedQuery.error),
        },
        { status: 400 }
      );
    }

    const programmeId = parsedParams.data.id;

    const programme = await prisma.programme.findFirst({
      where: { id: programmeId, tenantId: tenant.id },
      select: { id: true },
    });

    if (!programme) {
      return NextResponse.json(fail("Programme not found", "NOT_FOUND"), { status: 404 });
    }

    const { page, limit } = parsedQuery.data;

    // Filtered by tenantId as well as programmeId. The parent check already
    // proves the programme belongs to this tenant, so the tenant filter is
    // defence in depth rather than the primary guarantee; the query is served
    // by @@index([programmeId]) either way.
    const where = { tenantId: tenant.id, programmeId };

    // Paired in one transaction so the total cannot shift between the two
    // reads. The explicit ordering is required for correctness, not
    // presentation: offset pagination over an unordered result can repeat or
    // skip rows. Ordering matches every previous collection endpoint.
    const [specialisations, total] = await prisma.$transaction([
      prisma.specialisation.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.specialisation.count({ where }),
    ]);

    return NextResponse.json(
      ok({
        specialisations,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      })
    );
  } catch (err) {
    console.error("[GET /api/programmes/[id]/specialisations]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

// POST
// ACCESS     : UNIVERSITY_ADMIN
// VALIDATION : programmeIdParamSchema for the [id] segment,
//              createSpecialisationSchema for the body. name and code required;
//              description and isActive optional. Neither tenantId nor
//              programmeId is accepted from the client — the first comes from
//              the resolved tenant, the second from the route parameter.
// FLOW       : Authorise → resolve tenant → parse body → verify programme
//              ownership and code uniqueness as two independent reads issued
//              together → apply the results in a fixed precedence → create the
//              specialisation under the resolved tenant and the addressed
//              programme.
//              The ownership check is scoped by tenantId, so a programme owned
//              by another tenant is reported as NOT_FOUND exactly like a
//              nonexistent one. The database's foreign key cannot achieve this
//              on its own — it verifies only that the referenced row exists.
//              Uniqueness is checked against @@unique([tenantId, code]), which
//              spans the whole tenant rather than the single programme.
// RESPONSE   : { success: true, data: <Specialisation>,
//                message: "Specialisation created" }
// STATUS     : 201 Created · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 404 NOT_FOUND · 409 CONFLICT · 500 SERVER_ERROR
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const guard = await requireRole("UNIVERSITY_ADMIN");
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const { tenant } = tenantGuard;

    const parsedParams = programmeIdParamSchema.safeParse(await params);
    if (!parsedParams.success) {
      return NextResponse.json(
        {
          success: false as const,
          error: "Invalid input",
          code: "VALIDATION_ERROR",
          details: validationDetails(parsedParams.error),
        },
        { status: 400 }
      );
    }

    // A malformed body is a client error, so it is caught here rather than
    // being allowed to fall through to the 500 handler below.
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(fail("Invalid input", "VALIDATION_ERROR"), { status: 400 });
    }

    const parsedBody = createSpecialisationSchema.safeParse(body);
    if (!parsedBody.success) {
      return NextResponse.json(
        {
          success: false as const,
          error: "Invalid input",
          code: "VALIDATION_ERROR",
          details: validationDetails(parsedBody.error),
        },
        { status: 400 }
      );
    }

    const programmeId = parsedParams.data.id;
    const input = parsedBody.data;

    // Two independent reads, so they are issued together rather than in
    // sequence.
    const [programme, duplicate] = await Promise.all([
      prisma.programme.findFirst({
        where: { id: programmeId, tenantId: tenant.id },
        select: { id: true },
      }),
      prisma.specialisation.findUnique({
        where: { tenantId_code: { tenantId: tenant.id, code: input.code } },
        select: { id: true },
      }),
    ]);

    // Precedence is fixed so the reported error does not depend on which query
    // happened to resolve first: an invalid parent before a constraint clash.
    if (!programme) {
      return NextResponse.json(fail("Programme not found", "NOT_FOUND"), { status: 404 });
    }

    if (duplicate) {
      return NextResponse.json(
        fail("Specialisation code already in use", "CONFLICT"),
        { status: 409 }
      );
    }

    // Single write — already atomic, so no transaction is warranted. tenantId
    // comes from the resolved tenant context and programmeId from the route,
    // never from the request body.
    const specialisation = await prisma.specialisation.create({
      data: {
        ...input,
        tenantId: tenant.id,
        programmeId,
      },
    });

    return NextResponse.json(ok(specialisation, "Specialisation created"), { status: 201 });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      // A concurrent request took the code between the check and the insert.
      // This is the backstop the pre-check cannot provide: two requests can
      // both pass the lookup before either has written.
      if (err.code === UNIQUE_VIOLATION) {
        return NextResponse.json(
          fail("Specialisation code already in use", "CONFLICT"),
          { status: 409 }
        );
      }
      // The programme was deleted between the ownership check and the insert,
      // so the foreign key rejected the reference.
      if (isForeignKeyViolation(err)) {
        return NextResponse.json(fail("Programme not found", "NOT_FOUND"), { status: 404 });
      }
    }

    console.error("[POST /api/programmes/[id]/specialisations]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}
