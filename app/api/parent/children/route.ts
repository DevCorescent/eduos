// ============================================================================
// OWNER  : Gauransh
// MODULE : Parent Portal — My Children (W2, PRD §32)
// FLOW   : requireParent() → lib/services/parentPortal.service.
// ACCESS : PARENT only, linked to a Parent record in the resolved tenant.
// PURPOSE: The list every other parent route is scoped by. A parent may have
//          several children (StudentParent is many-to-many), so this is the
//          selector the portal drives from.
//
// THE LIST IS THE RELATIONSHIP
//   It is read from StudentParent, so "which children may I see" and "which
//   children are mine" are the same query. There is no separate permission
//   surface to keep in step, and no id from the client is involved at all.
// ============================================================================

import { NextResponse } from "next/server";
import { requireParent } from "@/lib/middleware/requireParent";
import { listChildren } from "@/lib/services/parentPortal.service";
import { ok, fail } from "@/types";

// GET
// ACCESS   : PARENT (+ tenant + linked Parent record)
// FLOW     : Authorise → read this parent's children within this tenant.
// RESPONSE : { success: true, data: { children } }
// STATUS   : 200 · 401 · 403 · 404 · 500
//
// Takes no parameters of any kind — there is nothing here a caller could aim
// at somebody else's family.
export async function GET() {
  try {
    const guard = await requireParent();
    if (!guard.authorized) return guard.response;

    const children = await listChildren(guard.parent.id, guard.tenant.id);

    return NextResponse.json(ok({ children }));
  } catch (err) {
    console.error("[GET /api/parent/children]", err);
    return NextResponse.json(fail("Internal server error", "SERVER_ERROR"), { status: 500 });
  }
}
