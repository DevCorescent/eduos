// ============================================================================
// OWNER  : Gauransh
// MODULE : Users & RBAC — User Collection
// FLOW   : Guard → tenant → query/body → duplicate check → hash → write →
//          response.
// ACCESS : UNIVERSITY_ADMIN
// BACKEND: Prisma
// PURPOSE: List and create users within the authenticated tenant.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { hashPassword } from "@/lib/auth/password";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { createUserSchema, listUsersQuerySchema } from "@/lib/validations/user";
import { sendMail } from "@/lib/services/mail";
import { invitationEmail } from "@/lib/services/invitationEmail";
import { ok, fail } from "@/types";
import { validationDetails } from "@/lib/utils/validation-error";

/** Prisma's unique-constraint violation code. */
const UNIQUE_VIOLATION = "P2002";

/**
 * Columns returned for a user. Declared once so every handler answers with the
 * same shape.
 *
 * passwordHash is deliberately absent and must stay absent. This is why the
 * handlers below use an explicit select rather than returning the Prisma model:
 * User.passwordHash is a plain column, so any query without a select would
 * place the bcrypt hash of every listed user directly into the response body.
 */
const USER_SELECT = {
  id: true,
  tenantId: true,
  email: true,
  phone: true,
  firstName: true,
  lastName: true,
  displayName: true,
  avatarUrl: true,
  isActive: true,
  isVerified: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

// User holds no BigInt, Decimal or Json column, so the shared serialize()
// helper is not applied here.

// GET
// ACCESS     : UNIVERSITY_ADMIN
// VALIDATION : listUsersQuerySchema — pagination plus ?q, ?roleId and
//              ?isActive. An empty filter value means "no filter" rather than
//              400, because that is what every ListFilter reset writes.
//              Tester issue #34: this parsed bare pagination, so Zod dropped
//              all three and the screen rendered its controls disabled.
// FLOW       : Authorise → resolve tenant → read one page of that tenant's
//              users alongside the total in a single transaction.
//              Both queries are filtered by the tenant id that requireTenant
//              proved equal to the caller's own, so no cross-tenant row is
//              reachable. userRoles is not expanded: README Phase 5 asks for
//              the user list only, and joining it would return one row per
//              assignment for every user on the page.
// RESPONSE   : { success: true, data: { users, pagination } }
// STATUS     : 200 OK · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 404 NOT_FOUND · 500 SERVER_ERROR
export async function GET(request: NextRequest) {
  try {
    const guard = await requireRole("UNIVERSITY_ADMIN");
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const { tenant } = tenantGuard;

    const parsed = listUsersQuerySchema.safeParse(
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

    const { page, limit, q, roleId, isActive } = parsed.data;

    // Whitespace-split so a full name typed into one box matches in any order:
    // User has firstName and lastName as separate columns and Prisma cannot
    // concatenate them, so a plain OR would match "Asha" and "Rao" but never
    // "Asha Rao". Every term must hit SOME column (AND of ORs), which is what
    // makes a second word narrow the result instead of widening it.
    //
    // The same shape the faculty, employee and course listings use.
    const terms = q ? q.split(/\s+/).filter(Boolean) : [];

    // The tenant predicate LEADS and every filter is ANDed onto it, so no
    // filter can widen the result beyond the caller's own tenant. A roleId
    // naming another tenant's role matches nobody rather than reaching across.
    const where: Prisma.UserWhereInput = {
      tenantId: tenant.id,
      ...(terms.length > 0
        ? {
            AND: terms.map((term) => ({
              OR: [
                { firstName: { contains: term, mode: "insensitive" as const } },
                { lastName: { contains: term, mode: "insensitive" as const } },
                { displayName: { contains: term, mode: "insensitive" as const } },
                { email: { contains: term, mode: "insensitive" as const } },
                { phone: { contains: term, mode: "insensitive" as const } },
                // The screen's placeholder says "name, email or role", so the
                // role name is searchable too — through the join table, since
                // User carries no role column of its own.
                { userRoles: { some: { role: { name: { contains: term, mode: "insensitive" as const } } } } },
              ],
            })),
          }
        : {}),
      // `some`, not `every`: a user holding several roles matches when ANY of
      // them is the one filtered for. The role is tenant-scoped alongside, so
      // a guessed id from another tenant cannot select anybody.
      ...(roleId ? { userRoles: { some: { roleId, role: { tenantId: tenant.id } } } } : {}),
      // Explicitly undefined-checked rather than truthy: `false` is a real
      // filter value here and `...(isActive ? …)` would drop the Inactive case
      // entirely.
      ...(isActive === undefined ? {} : { isActive }),
    };

    // Paired in one transaction so the total cannot shift between the two
    // reads. The ordering is required for correctness, not presentation:
    // offset pagination over an unordered result can repeat or skip rows, and
    // the id tiebreaker matters because users created in the same batch can
    // share a createdAt timestamp, leaving createdAt alone non-deterministic.
    const [users, total] = await prisma.$transaction([
      prisma.user.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * limit,
        take: limit,
        select: USER_SELECT,
      }),
      prisma.user.count({ where }),
    ]);

    return NextResponse.json(
      ok({
        users,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      })
    );
  } catch (err) {
    console.error("[GET /api/users]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}

// POST
// ACCESS     : UNIVERSITY_ADMIN
// VALIDATION : createUserSchema — email, password, firstName and lastName
//              required; phone, displayName, avatarUrl, isActive and
//              sendInvitation optional. tenantId, passwordHash and isVerified
//              are absent from the schema and so are stripped from any body
//              that supplies them.
//
//              sendInvitation is an instruction to this handler rather than a
//              column, and is opt-in: Invite User sets it, while Add Faculty,
//              Add Employee and Enrol Student post here without it and are
//              unaffected. See the invitation block below — tester issue #36.
// FLOW       : Authorise → resolve tenant → parse body → reject an email
//              already used within this tenant → hash the password → create the
//              user under the resolved tenant.
//              User.email is unique per tenant via @@unique([tenantId, email]),
//              so the same address may legitimately exist under a different
//              tenant. User has no foreign key of its own beyond the tenant, so
//              there is no reference to validate.
//              The plaintext password never reaches Prisma: it is destructured
//              away and only the bcrypt hash is written. isVerified is written
//              as false explicitly rather than left to the database default, so
//              a user created through the API is never marked email-verified
//              regardless of what the client sent.
// RESPONSE   : { success: true, data: <User>, message: "User created" }
// STATUS     : 201 Created · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 404 NOT_FOUND · 409 CONFLICT · 500 SERVER_ERROR
export async function POST(request: NextRequest) {
  try {
    const guard = await requireRole("UNIVERSITY_ADMIN");
    if (!guard.authorized) return guard.response;

    const tenantGuard = await requireTenant();
    if (!tenantGuard.resolved) return tenantGuard.response;

    const { tenant } = tenantGuard;

    // A malformed body is a client error, so it is caught here rather than
    // being allowed to fall through to the 500 handler below.
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(fail("Invalid input", "VALIDATION_ERROR"), { status: 400 });
    }

    const parsed = createUserSchema.safeParse(body);
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

    // sendInvitation is pulled OUT of the spread deliberately: it is an
    // instruction to this handler, not a User column, and leaving it in
    // `profile` would send it straight into prisma.user.create.
    const { password, sendInvitation, ...profile } = parsed.data;

    const existing = await prisma.user.findUnique({
      where: { tenantId_email: { tenantId: tenant.id, email: profile.email } },
      select: { id: true },
    });

    if (existing) {
      return NextResponse.json(fail("Email already in use", "CONFLICT"), { status: 409 });
    }

    // Hashing runs after the duplicate check rather than alongside it. The two
    // are independent, but bcrypt at the configured cost dominates the round
    // trip by an order of magnitude, so overlapping them would save only the
    // lookup's latency while burning the full hashing cost on every rejected
    // duplicate — work an unauthenticated-looking retry loop could trivially
    // amplify. Sequencing keeps the rejected path cheap.
    const passwordHash = await hashPassword(password);

    // Single write — already atomic, so no transaction is warranted. tenantId
    // comes from the resolved tenant context and isVerified is forced false,
    // never from the request body. Both are placed after the spread so a future
    // schema change could not let them be overridden by it.
    const user = await prisma.user.create({
      data: {
        ...profile,
        tenantId: tenant.id,
        passwordHash,
        isVerified: false,
      },
      select: USER_SELECT,
    });

    // --- Invitation email — tester issue #36 --------------------------------
    //
    // "The user is created successfully, but the invitation email is not
    // received." Nothing sent one: this handler created the row and returned.
    // There was no trigger, no template and no failure to diagnose.
    //
    // SENT ONLY WHEN ASKED. Add Faculty, Add Employee and Enrol Student post
    // here too and do not set the flag, so they are unchanged — see
    // createUserSchema.sendInvitation.
    //
    // EVERY VALUE IS SERVER-RESOLVED. The recipient is `user.email`, read back
    // from the row that was just written, never `profile.email` from the body;
    // the institution is `tenant.name`, read from the database by requireTenant;
    // and the origin is the host requireTenant already PROVED resolves to this
    // caller's own tenant, so the link cannot point at another university's
    // sign-in page.
    //
    // AFTER the write, never inside it. The account exists either way, and a
    // mail relay being down must not roll back a created user.
    let message = "User created";

    if (sendInvitation) {
      const { subject, text } = invitationEmail({
        tenantName: tenant.name,
        email: user.email,
        signInUrl: `${request.nextUrl.origin}/login`,
      });

      const delivery = await sendMail({ to: user.email, subject, text });

      if (delivery.delivered) {
        message = "User invited";
      } else {
        // The provider's reason can name the recipient and the relay host, so
        // it goes to the server log and never into the response body — the same
        // rule POST /api/auth/forgot-password follows. No password and no token
        // is logged, because neither is in the message.
        console.error("[POST /api/users] invitation delivery failed:", delivery.reason);

        // 201 still, because the account really was created — but the message
        // says what did NOT happen rather than reporting a send that failed as
        // a success. An administrator who reads "User created" and no more can
        // pass the password on themselves; one told "invited" when nothing left
        // the building would wait for a mail that never arrives, which is
        // precisely how this issue was reported.
        message = "User created, but the invitation email could not be sent";
      }
    }

    return NextResponse.json(ok(user, message), { status: 201 });
  } catch (err) {
    // The uniqueness pre-check above narrows the common case; this covers the
    // race where a concurrent request inserted the same email in between.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === UNIQUE_VIOLATION) {
      return NextResponse.json(fail("Email already in use", "CONFLICT"), { status: 409 });
    }

    console.error("[POST /api/users]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}
