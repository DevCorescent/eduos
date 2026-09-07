// ============================================================================
// TESTS: Users & Roles search and filters — tester issues #34 and #35.
//
// THE DEFECT, TWICE
//   #34 "Users & Roles → Search and filters are not working."
//   #35 "Users & Roles → Manage Role → Roles → Search is not working."
//
//   Both had the same cause. listUsersQuerySchema and listRolesQuerySchema were
//   each `paginationQuerySchema` and nothing more, so Zod dropped every other
//   key before the handler saw it and both routes read the whole tenant. Both
//   screens knew: each rendered its controls DISABLED with a note saying they
//   would work once the backend accepted the parameters.
//
//   It is the same defect that produced tester issues #22 (batches), #23
//   (students), #26 (faculty), #28 (employees) and #30 (courses), and it is
//   pinned here the same way those are.
//
// A NOTE ON #35 AND "FILTERS"
//   The tester reported "search and filters" for Roles. The Roles screen has
//   never rendered a filter control — not one ListFilter — so there is nothing
//   to wire and none was invented. The assertions below pin that absence, so a
//   future filter arrives with its parameter rather than as another disabled
//   control.
//
// WHAT IS ASSERTED WHERE
//   The schemas are exercised directly. The routes reach a database and this
//   suite has none — see package.json — so their guarantees are pinned as
//   source contracts, and the behaviours that need real rows are covered by
//   live verification against the running API.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { listUsersQuerySchema } from "./user";
import { listRolesQuerySchema } from "./role";

const usersRoute = readFileSync(join(process.cwd(), "app/api/users/route.ts"), "utf8");
const rolesRoute = readFileSync(join(process.cwd(), "app/api/roles/route.ts"), "utf8");
const usersPage = readFileSync(
  join(process.cwd(), "app/(university)/users/page.tsx"),
  "utf8"
);
const rolesPage = readFileSync(
  join(process.cwd(), "app/(university)/users/roles/page.tsx"),
  "utf8"
);

// ============================================================================
// #34 — USERS
// ============================================================================

describe("#34 — the user query schema accepts what the screen sends", () => {
  it("accepts q", () => {
    const parsed = listUsersQuerySchema.safeParse({ q: "asha" });
    assert.ok(parsed.success);
    assert.equal(parsed.data.q, "asha");
  });

  it("accepts roleId", () => {
    const parsed = listUsersQuerySchema.safeParse({ roleId: "role_1" });
    assert.ok(parsed.success);
    assert.equal(parsed.data.roleId, "role_1");
  });

  it("accepts isActive as the strings the control writes", () => {
    const active = listUsersQuerySchema.safeParse({ isActive: "true" });
    assert.ok(active.success);
    assert.equal(active.data.isActive, true);

    const inactive = listUsersQuerySchema.safeParse({ isActive: "false" });
    assert.ok(inactive.success);
    assert.equal(inactive.data.isActive, false);
  });

  it('"false" becomes FALSE, not truthy', () => {
    // The trap z.coerce.boolean() would have walked into: it is truthiness, so
    // the string "false" coerces to true and the Inactive filter silently
    // returns active users — a wrong result that looks like it worked.
    const parsed = listUsersQuerySchema.safeParse({ isActive: "false" });
    assert.ok(parsed.success);
    assert.notEqual(parsed.data.isActive, true);
    assert.strictEqual(parsed.data.isActive, false);
  });

  it("accepts all three together", () => {
    const parsed = listUsersQuerySchema.safeParse({
      q: "asha rao",
      roleId: "role_1",
      isActive: "true",
    });
    assert.ok(parsed.success);
  });

  it('treats "" as no filter, which is what every reset writes', () => {
    const parsed = listUsersQuerySchema.safeParse({ q: "", roleId: "", isActive: "" });

    assert.ok(parsed.success, "an empty filter must not be a 400");
    assert.equal(parsed.data.q, undefined);
    assert.equal(parsed.data.roleId, undefined);
    assert.equal(parsed.data.isActive, undefined);
  });

  it("REFUSES an isActive that is not true or false", () => {
    assert.equal(listUsersQuerySchema.safeParse({ isActive: "maybe" }).success, false);
    assert.equal(listUsersQuerySchema.safeParse({ isActive: "1" }).success, false);
  });

  it("keeps the shared pagination contract", () => {
    const parsed = listUsersQuerySchema.safeParse({});
    assert.ok(parsed.success);
    assert.equal(typeof parsed.data.page, "number");
    assert.equal(typeof parsed.data.limit, "number");
    assert.equal(parsed.data.page, 1);
  });

  it("accepts NO tenantId — the tenant is never a query parameter", () => {
    const parsed = listUsersQuerySchema.safeParse({ tenantId: "other_tenant" });
    assert.ok(parsed.success);
    assert.ok(!("tenantId" in parsed.data));
  });
});

describe("#34 — the users route reads and applies them", () => {
  it("destructures all three out of the validated query", () => {
    assert.match(usersRoute, /const \{ page, limit, q, roleId, isActive \} = parsed\.data;/);
  });

  it("searches name, email, phone and role", () => {
    // The screen's placeholder promises "name, email or role".
    for (const field of ["firstName", "lastName", "displayName", "email", "phone"]) {
      assert.match(usersRoute, new RegExp(`\\{ ${field}: \\{ contains: term`), `q must cover ${field}`);
    }
    assert.match(
      usersRoute,
      /userRoles: \{ some: \{ role: \{ name: \{ contains: term/,
      "the role name must be searchable, as the placeholder promises"
    );
  });

  it("searches case-insensitively with contains, not equality", () => {
    assert.match(usersRoute, /mode: "insensitive" as const/);
    assert.match(usersRoute, /contains: term/);
  });

  it("splits the term so a full name typed in one box matches in any order", () => {
    // User has firstName and lastName as separate columns and Prisma cannot
    // concatenate them, so a plain OR would match "Asha" and "Rao" but never
    // "Asha Rao".
    assert.match(usersRoute, /q\.split\(\/\\s\+\/\)/);
    assert.match(usersRoute, /AND: terms\.map/);
  });

  it("filters roleId through the join table with `some`, not `every`", () => {
    // A user holding several roles matches when ANY of them is the one filtered
    // for; `every` would return only single-role users.
    assert.match(usersRoute, /userRoles: \{ some: \{ roleId, role: \{ tenantId: tenant\.id \} \} \}/);
  });

  it("filters isActive by an explicit undefined check, not truthiness", () => {
    // `...(isActive ? { isActive } : {})` would drop the Inactive case
    // entirely, because `false` is falsy — the filter would appear to do
    // nothing for exactly one of its two values.
    assert.match(usersRoute, /isActive === undefined \? \{\} : \{ isActive \}/);
  });

  it("leads the where clause with the tenant and ANDs every filter onto it", () => {
    assert.match(usersRoute, /const where: Prisma\.UserWhereInput = \{\s*tenantId: tenant\.id,/);
  });

  it("never reads a client-supplied tenantId", () => {
    assert.ok(
      !/tenantId: (parsed|input|query|body)/.test(usersRoute),
      "the tenant must come from the session, never the query string"
    );
  });

  it("scopes the roleId filter to the tenant as well", () => {
    // A guessed role id from another tenant must select nobody rather than
    // reaching across.
    assert.match(usersRoute, /roleId, role: \{ tenantId: tenant\.id \}/);
  });

  it("uses ONE where for both the page and the count", () => {
    // A count over a wider predicate reports a total the filtered list cannot
    // reach, and paginates into empty pages.
    assert.match(usersRoute, /prisma\.user\.findMany\(\{\s*where,/);
    assert.match(usersRoute, /prisma\.user\.count\(\{ where \}\)/);
  });

  it("preserves the existing ordering and response shape", () => {
    assert.match(usersRoute, /orderBy: \[\{ createdAt: "desc" \}, \{ id: "desc" \}\]/);
    assert.match(usersRoute, /skip: \(page - 1\) \* limit/);
    assert.match(usersRoute, /take: limit/);
    assert.match(usersRoute, /ok\(\{\s*users,\s*pagination:/);
    assert.match(usersRoute, /totalPages: Math\.ceil\(total \/ limit\)/);
  });

  it("keeps its authorization unchanged", () => {
    assert.match(usersRoute, /requireRole\("UNIVERSITY_ADMIN"\)/);
    assert.match(usersRoute, /await requireTenant\(\)/);
  });
});

describe("#34 — the Users & Roles screen", () => {
  it("no longer renders its search and filters disabled", () => {
    assert.ok(
      !/unsupported=/.test(usersPage),
      "the controls must be live now that the API accepts the parameters"
    );
    assert.ok(!/UNSUPPORTED_/.test(usersPage), "the disabled-state constants are gone");
  });

  it("still sends the same three parameters", () => {
    assert.match(
      usersPage,
      /listUsers\(\{ page: currentPage, limit: PAGE_SIZE, q, roleId, isActive \}\)/
    );
  });

  it("still carries all three through pagination", () => {
    const pagination = usersPage.slice(usersPage.indexOf("searchParams={{"));
    for (const key of ["q", "roleId", "isActive"]) {
      assert.ok(pagination.includes(key), `pagination must carry ${key}`);
    }
  });

  it("keeps its placeholder and BOTH filters — none was removed", () => {
    assert.match(usersPage, /Search by name, email or role/);
    assert.match(usersPage, /paramKey="roleId"/);
    assert.match(usersPage, /paramKey="isActive"/);
  });

  it("the status filter still offers exactly the two values the schema accepts", () => {
    assert.match(usersPage, /value: "true", label: "Active"/);
    assert.match(usersPage, /value: "false", label: "Inactive"/);
  });
});

// ============================================================================
// #35 — ROLES
// ============================================================================

describe("#35 — the role query schema accepts what the screen sends", () => {
  it("accepts q", () => {
    const parsed = listRolesQuerySchema.safeParse({ q: "exam" });
    assert.ok(parsed.success);
    assert.equal(parsed.data.q, "exam");
  });

  it('treats "" as no filter', () => {
    const parsed = listRolesQuerySchema.safeParse({ q: "" });
    assert.ok(parsed.success, "clearing the box must not be a 400");
    assert.equal(parsed.data.q, undefined);
  });

  it("trims surrounding whitespace", () => {
    const parsed = listRolesQuerySchema.safeParse({ q: "  exam  " });
    assert.ok(parsed.success);
    assert.equal(parsed.data.q, "exam");
  });

  it("keeps the shared pagination contract", () => {
    const parsed = listRolesQuerySchema.safeParse({});
    assert.ok(parsed.success);
    assert.equal(typeof parsed.data.page, "number");
    assert.equal(typeof parsed.data.limit, "number");
  });

  it("accepts NO tenantId", () => {
    const parsed = listRolesQuerySchema.safeParse({ tenantId: "other_tenant" });
    assert.ok(parsed.success);
    assert.ok(!("tenantId" in parsed.data));
  });

  it("adds NO filter parameter the screen does not send", () => {
    // The Roles screen renders no ListFilter, so accepting ?isSystem here would
    // be inventing a capability nothing sends — which is how the whole
    // disabled-control problem started.
    const parsed = listRolesQuerySchema.safeParse({ isSystem: "true" });
    assert.ok(parsed.success);
    assert.ok(!("isSystem" in parsed.data));
  });
});

describe("#35 — the roles route reads and applies it", () => {
  it("destructures q out of the validated query", () => {
    assert.match(rolesRoute, /const \{ page, limit, q \} = parsed\.data;/);
  });

  it("searches name and description", () => {
    assert.match(rolesRoute, /\{ name: \{ contains: term, mode: "insensitive" as const \} \}/);
    assert.match(rolesRoute, /\{ description: \{ contains: term, mode: "insensitive" as const \} \}/);
  });

  it("splits the term, AND of ORs", () => {
    assert.match(rolesRoute, /q\.split\(\/\\s\+\/\)/);
    assert.match(rolesRoute, /AND: terms\.map/);
  });

  it("leads the where clause with the tenant", () => {
    assert.match(rolesRoute, /const where: Prisma\.RoleWhereInput = \{\s*tenantId: tenant\.id,/);
  });

  it("never reads a client-supplied tenantId", () => {
    assert.ok(!/tenantId: (parsed|input|query|body)/.test(rolesRoute));
  });

  it("uses ONE where for both the page and the count", () => {
    // Previously each restated `{ tenantId: tenant.id }` inline; with a filter
    // in play they must be the same object or the total disagrees with the rows.
    assert.match(rolesRoute, /prisma\.role\.findMany\(\{\s*where,/);
    assert.match(rolesRoute, /prisma\.role\.count\(\{ where \}\)/);
  });

  it("preserves the existing ordering and response shape", () => {
    assert.match(rolesRoute, /orderBy: \{ createdAt: "desc" \}/);
    assert.match(rolesRoute, /skip: \(page - 1\) \* limit/);
    assert.match(rolesRoute, /take: limit/);
    assert.match(rolesRoute, /ok\(\{\s*roles,\s*pagination:/);
  });

  it("keeps its authorization unchanged", () => {
    assert.match(rolesRoute, /requireRole\("UNIVERSITY_ADMIN"\)/);
    assert.match(rolesRoute, /await requireTenant\(\)/);
  });
});

describe("#35 — the Roles screen", () => {
  it("no longer renders its search disabled", () => {
    assert.ok(!/unsupported=/.test(rolesPage));
    assert.ok(!/UNSUPPORTED_/.test(rolesPage));
  });

  it("still sends q", () => {
    assert.match(rolesPage, /listRoles\(\{ page: 1, limit: 100, q \}\)/);
  });

  it("keeps its placeholder", () => {
    assert.match(rolesPage, /placeholder="Search roles…"/);
  });

  it("renders no filter control — so none was invented in the API", () => {
    assert.ok(
      !/ListFilter/.test(rolesPage),
      "if a filter is added here, its parameter must be added to the schema with it"
    );
  });
});
