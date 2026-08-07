// ============================================================================
// OWNER  : Gauransh
// MODULE : Notification Center & Announcement System (Phase 27)
// LAYER  : Middleware (route guard)
// PURPOSE: Admit any of the seven roles to their OWN notification centre,
//          resolve their tenant, and establish whether they may manage
//          announcements — in ONE call.
//
// ADMITTING EVERY ROLE IS SAFE BECAUSE THE CONFINEMENT IS BY RECIPIENT
//   A notification centre that only administrators can open is not one, and the
//   README's Phase 27 names all seven roles. Admitting them here grants access
//   to the caller's OWN bell and nothing else: every repository predicate
//   includes `userId = session.sub`, and no method reads a notification by id
//   alone.
//
// THE MANAGE FLAG IS RESOLVED HERE, NOT INFERRED IN THE SERVICE
//   `canManageAnnouncements` is what stops a student reading a draft by setting
//   `?includeUnpublished=true`. Deciding it from a live role check rather than
//   from the token's claims means a revoked role takes effect on the next
//   request rather than at token expiry — the same reasoning requireRole itself
//   documents.
//
// WHY THE MANAGE CHECK RUNS FIRST
//   Role precedence is manager > ordinary reader. Testing the narrow set first
//   means a manager pays one role call and everyone else pays two. It also
//   keeps the failure codes right: an anonymous caller fails both and receives
//   requireAuth's 401 from the second.
// ============================================================================

import type { NextResponse } from "next/server";
import { requireRole as defaultRequireRole } from "@/lib/middleware/requireRole";
import { requireTenant as defaultRequireTenant } from "@/lib/middleware/requireTenant";
import {
  ANNOUNCEMENT_MANAGE_ROLES,
  NOTIFICATION_CENTER_ROLES,
} from "@/lib/constants/notificationCenter";
import type { NotificationAccess } from "@/lib/services/notificationCenter.service";
import type { ApiResponse } from "@/types";

/** Either the caller's context, or the response to return to them as-is. */
export type NotificationAccessGuard =
  | { granted: true; access: NotificationAccess }
  | { granted: false; response: NextResponse<ApiResponse<never>> };

/** The guards this middleware composes. Injected so every branch is testable. */
export interface NotificationAccessDeps {
  requireRole: typeof defaultRequireRole;
  requireTenant: typeof defaultRequireTenant;
}

const DEFAULT_DEPS: NotificationAccessDeps = {
  requireRole: defaultRequireRole,
  requireTenant: defaultRequireTenant,
};

/**
 * Resolve a notification-centre caller.
 *
 * COMPLEXITY : one or two role calls plus one tenant call.
 */
export async function requireNotificationAccess(
  deps: NotificationAccessDeps = DEFAULT_DEPS
): Promise<NotificationAccessGuard> {
  const manager = await deps.requireRole(...ANNOUNCEMENT_MANAGE_ROLES);

  if (manager.authorized) {
    const tenantGuard = await deps.requireTenant();

    if (!tenantGuard.resolved) {
      return { granted: false, response: tenantGuard.response };
    }

    return {
      granted: true,
      access: {
        tenantId: tenantGuard.tenant.id,
        userId: manager.session.sub,
        canManageAnnouncements: true,
      },
    };
  }

  const reader = await deps.requireRole(...NOTIFICATION_CENTER_ROLES);

  if (!reader.authorized) {
    return { granted: false, response: reader.response };
  }

  const tenantGuard = await deps.requireTenant();

  if (!tenantGuard.resolved) {
    return { granted: false, response: tenantGuard.response };
  }

  return {
    granted: true,
    access: {
      tenantId: tenantGuard.tenant.id,
      // The authenticated subject. Every notification predicate is anchored on
      // this; nothing a client sends can influence it.
      userId: reader.session.sub,
      canManageAnnouncements: false,
    },
  };
}

/**
 * Guard an announcement WRITE.
 *
 * Separate from the read guard because writing is genuinely narrower: FACULTY,
 * STUDENT and PARENT may read announcements addressed to them and may not
 * write any. Expressing that as a boolean on the read guard would have made it
 * possible to forget the check at a call site; a distinct function cannot be
 * forgotten, because the wrong one does not compile into the right shape.
 */
export async function requireAnnouncementManageAccess(
  deps: NotificationAccessDeps = DEFAULT_DEPS
): Promise<NotificationAccessGuard> {
  const guard = await deps.requireRole(...ANNOUNCEMENT_MANAGE_ROLES);

  if (!guard.authorized) {
    return { granted: false, response: guard.response };
  }

  const tenantGuard = await deps.requireTenant();

  if (!tenantGuard.resolved) {
    return { granted: false, response: tenantGuard.response };
  }

  return {
    granted: true,
    access: {
      tenantId: tenantGuard.tenant.id,
      userId: guard.session.sub,
      canManageAnnouncements: true,
    },
  };
}
