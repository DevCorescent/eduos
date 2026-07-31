// ============================================================================
// OWNER  : Gauransh
// MODULE : Email Notifications — Notification Creation
// FLOW   : Guard → tenant → body → tenant-scoped reference checks → one atomic
//          createMany → response.
// ACCESS : UNIVERSITY_ADMIN only. FACULTY, STUDENT and PARENT cannot create
//          notifications.
// BACKEND: Prisma
// PURPOSE: Record one Notification row per named recipient for the authenticated
//          tenant. Nothing is transmitted: no mail is sent, no provider is
//          contacted, no queue is enqueued and no delivery is scheduled.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { Prisma, NotificationType } from "@/app/generated/prisma/client";
import { requireRole } from "@/lib/middleware/requireRole";
import { requireTenant } from "@/lib/middleware/requireTenant";
import { isForeignKeyViolation } from "@/lib/utils/prisma-errors";
import { ok, fail } from "@/types";

/**
 * Body schema for POST /api/notifications/send.
 *
 * Declared here rather than in a validation module because no notification
 * validation module exists and this phase generates only this file. It is the
 * fourth route-local validation contract in the project, after the examination
 * results upload, the fee-demand list filters and the finance report query.
 *
 * userIds is required and must be non-empty. Each entry is an opaque non-empty
 * key; no format is asserted, because Notification.userId is a bare nullable
 * String with no foreign key and no relation, and asserting a shape would turn an
 * unrecognised-but-well-formed id into a 400 where 404 is accurate. Entries are
 * taken exactly as sent — no recipient is inferred, no group is expanded, and
 * nothing is deduplicated.
 *
 * type is required and validated directly against the Prisma enum.
 * Notification.type is NOT NULL with no default, so a row cannot be written
 * without one and it cannot be derived: the referenced template is never read,
 * and defaulting to EMAIL because the phase is titled "Email Notifications"
 * would be inferring a value the schema does not supply. This applies the same
 * approved decision already made for NotificationTemplate.type — required,
 * validated against NotificationType, never derived. It is the one field in this
 * schema not named in the approved rule list, and it is present because the
 * column makes it unavoidable.
 *
 * subject and body always come from the request. Notification.subject is nullable
 * and body is NOT NULL, but both are required here by approved decision, and
 * neither is ever taken from a template.
 *
 * subject is trimmed and must be non-empty once trimmed. body is required and
 * non-empty but deliberately NOT trimmed, matching
 * lib/validations/notification-template.ts: it is the message content itself, and
 * its leading and trailing whitespace can be significant in a plain-text or
 * preformatted part. The consequence is that a whitespace-only body passes
 * .min(1); that follows from storing content verbatim and is recorded as
 * technical debt rather than resolved by adding a rule.
 *
 * templateId is optional and is provenance only. It is verified to exist within
 * this tenant when supplied, and then written unchanged — nothing is read from
 * the template, nothing is copied, nothing is rendered and no placeholder is
 * substituted.
 *
 * data is not accepted. It is a nullable Json column with no declared structure
 * and no rule assigning it a meaning on this endpoint, so it is left NULL rather
 * than given one here.
 *
 * Absent, and therefore stripped from any body that supplies them: id, tenantId
 * and createdAt (server-managed), and status, sentAt, readAt and error — the four
 * delivery columns, which are left entirely to the database. status takes its
 * DEFAULT 'PENDING' and the other three stay NULL, so nothing is marked sent,
 * delivered, read or failed by this route.
 */
const sendNotificationSchema = z.object({
  userIds: z.array(z.string().trim().min(1)).min(1),
  type: z.enum(NotificationType),
  subject: z.string().trim().min(1),
  body: z.string().min(1),
  templateId: z.string().trim().min(1).optional(),
});

// POST
// ACCESS     : UNIVERSITY_ADMIN only. A single requireRole call decides access,
//              matching the notification-template routes.
// VALIDATION : sendNotificationSchema — userIds (non-empty array), type, subject
//              and body required; templateId optional.
// FLOW       : Authorise → resolve tenant → parse body → verify the template and
//              every recipient against this tenant → write every row in one
//              atomic statement.
//
//              REFERENCES. templateId carries a real foreign key to
//              NotificationTemplate, but a foreign key proves a row exists
//              somewhere rather than that it belongs to the caller's tenant, so
//              it is looked up filtered by BOTH id and tenantId when supplied.
//              userId carries no foreign key and no relation at all, so the
//              tenant-scoped User lookup is the only thing standing between a
//              client-supplied string and a stored recipient.
//
//              Recipients are verified as a distinct set, so repeating an id in
//              the request cannot make a valid recipient look missing. Every
//              distinct id must resolve to a User of this tenant; if any does
//              not, the whole request is refused and nothing is written. An
//              unknown id and one owned by another tenant produce the identical
//              404, and the response names no id, so neither existence nor
//              ownership is ever disclosed — a caller cannot use this endpoint to
//              probe which user ids exist elsewhere.
//
//              Precedence is fixed so the reported error does not depend on which
//              query resolved first, and follows the schema's column order:
//              template, then recipients.
//
//              WRITE. One createMany, wrapped in $transaction as required. The
//              statement is already atomic on its own — Postgres executes a
//              multi-row INSERT as a single statement — so the transaction adds a
//              boundary rather than changing the outcome: either every row is
//              written or none is, and a partial send is impossible.
//
//              One row per entry in userIds, taken verbatim. Duplicates are not
//              removed: dropping a row the caller asked for would silently change
//              the request, and the schema declares no uniqueness that would
//              refuse it. A userIds array naming the same recipient twice
//              therefore produces two notifications, exactly as asked.
//
//              tenantId comes from the resolved tenant context, never from the
//              body. subject and body are written exactly as validated.
//
//              NOT DONE HERE. Nothing is transmitted. No SMTP, SES, Resend or
//              Nodemailer client exists in this file; no queue is enqueued, no
//              delivery is scheduled and no failure is retried. No template is
//              read, rendered or interpolated, no placeholder is validated and no
//              HTML is generated. status, sentAt, readAt and error are never
//              written, so every row is created PENDING with a null sentAt — the
//              database's own account of a notification that has been recorded
//              and not yet delivered.
// RESPONSE   : { success: true, data: { created }, message: "Notifications created" }
// STATUS     : 201 Created · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
//              403 FORBIDDEN · 404 NOT_FOUND · 500 SERVER_ERROR
//
//              The created rows are not echoed. createMany does not return them,
//              and the approved contract is a count — the same trade
//              POST /api/fee-demands/generate and POST /api/attendance already
//              make.
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

    const parsed = sendNotificationSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(fail("Invalid input", "VALIDATION_ERROR"), { status: 400 });
    }

    const { userIds, templateId, ...scalars } = parsed.data;

    // Verified as a distinct set so a repeated id cannot make a valid recipient
    // look missing. The rows written below still follow userIds verbatim.
    const distinctUserIds = [...new Set(userIds)];

    // Two independent reads, so they are issued together rather than in
    // sequence. The template read is skipped entirely when no template was
    // supplied, since the column is nullable.
    const [template, users] = await Promise.all([
      templateId === undefined
        ? Promise.resolve(null)
        : prisma.notificationTemplate.findFirst({
            where: { id: templateId, tenantId: tenant.id },
            select: { id: true },
          }),
      prisma.user.findMany({
        where: { id: { in: distinctUserIds }, tenantId: tenant.id },
        select: { id: true },
      }),
    ]);

    // Precedence is fixed so the reported error does not depend on which query
    // resolved first. The order follows the schema's column order.
    if (templateId !== undefined && !template) {
      return NextResponse.json(fail("Notification template not found", "NOT_FOUND"), { status: 404 });
    }

    // Every distinct recipient must belong to this tenant. The response names no
    // id, so an unknown recipient and a cross-tenant one are indistinguishable.
    if (users.length !== distinctUserIds.length) {
      return NextResponse.json(fail("User not found", "NOT_FOUND"), { status: 404 });
    }

    // One statement, wrapped as required so the request is all-or-nothing. One
    // row per entry in userIds, verbatim — duplicates are preserved rather than
    // silently dropped. tenantId comes from the resolved tenant context, and
    // status, sentAt, readAt and error are never mentioned, so their database
    // defaults stand.
    const [created] = await prisma.$transaction([
      prisma.notification.createMany({
        data: userIds.map((userId) => ({
          ...scalars,
          tenantId: tenant.id,
          templateId: templateId ?? null,
          userId,
        })),
      }),
    ]);

    return NextResponse.json(ok({ created: created.count }, "Notifications created"), {
      status: 201,
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      // Currently unreachable — the template and every recipient were proven to
      // exist moments earlier, and Notification declares no unique constraint —
      // but the template can be deleted in that window, so a foreign-key failure
      // is reported as the same 404 the pre-check would have produced.
      if (isForeignKeyViolation(err)) {
        return NextResponse.json(fail("Notification template not found", "NOT_FOUND"), { status: 404 });
      }
    }

    console.error("[POST /api/notifications/send]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}
