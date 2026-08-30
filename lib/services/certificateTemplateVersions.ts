// ============================================================================
// OWNER  : Gauransh
// MODULE : Certificates — Template versioning
// LAYER  : Service (data access)
// PURPOSE: Decide whether an edit updates a template in place or forks a new
//          version, and do whichever it is.
//
// THE RULE, AND WHY IT IS THIS ONE
//   A template that has never issued anything is a draft in every meaningful
//   sense, whatever its status says: editing it changes a design nobody holds,
//   so it is updated in place and no version is burned.
//
//   The moment a template has issued even one certificate, its design is part
//   of a document somebody was handed. Editing it then writes a NEW ROW —
//   version + 1, same lineage — and the old row is left exactly as it was. It
//   is never mutated and never deleted, because a certificate references it.
//
// A STATUS-ONLY CHANGE NEVER FORKS
//   Archiving or publishing does not alter the design, so it applies in place
//   even on a template with issued certificates. Forking there would litter the
//   history with versions that differ in nothing.
//
// BELT AND BRACES
//   Issued certificates ALSO carry a snapshot of the markup they were rendered
//   from (Certificate.templateSnapshot), so a certificate is immutable even if
//   its template row were somehow lost. This module keeps the history readable;
//   the snapshot is what makes the document itself unchangeable.
// ============================================================================

import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/app/generated/prisma/client";

/** Fields whose change alters the DESIGN, and therefore forks a version. */
const DESIGN_FIELDS = ["htmlTemplate", "cssStyles", "name", "type"] as const;

export type TemplatePatch = Partial<{
  name: string;
  type: string;
  htmlTemplate: string;
  cssStyles: string;
  variables: Record<string, unknown>;
  isActive: boolean;
}>;

/** True when this patch changes something a holder would see on the paper. */
export function touchesDesign(patch: TemplatePatch): boolean {
  return DESIGN_FIELDS.some((field) => patch[field] !== undefined);
}

/**
 * The id every version of a template shares.
 *
 * The first row of a lineage has no parent and is its own root, so the root is
 * `parentTemplateId ?? id` — one expression, no walk.
 */
export function lineageRootId(row: { id: string; parentTemplateId: string | null }): string {
  return row.parentTemplateId ?? row.id;
}

/**
 * Apply an edit, forking a new version when the design of an ISSUED template
 * changes.
 *
 * INPUT   : the tenant (already resolved by requireTenant — never from the
 *           request), the template id, and the validated patch.
 * RETURNS : the row that now represents the edit — the same row when applied in
 *           place, a new one when forked. `forked` tells the caller which
 *           happened so the UI can say so.
 *
 * The count and the write share one transaction: a certificate issued between
 * the two would otherwise let a design change slip into a template that had
 * just become historical.
 */
export async function applyTemplateEdit(
  tenantId: string,
  templateId: string,
  patch: TemplatePatch
): Promise<
  | { ok: true; forked: boolean; template: { id: string; version: number; name: string } }
  | { ok: false; error: "NOT_FOUND" }
> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.certificateTemplate.findFirst({
      where: { id: templateId, tenantId },
      select: {
        id: true,
        tenantId: true,
        name: true,
        type: true,
        htmlTemplate: true,
        cssStyles: true,
        variables: true,
        isActive: true,
        version: true,
        parentTemplateId: true,
      },
    });

    if (!existing) return { ok: false as const, error: "NOT_FOUND" as const };

    const issued = await tx.certificate.count({
      where: { templateId: existing.id, tenantId },
    });

    const mustFork = issued > 0 && touchesDesign(patch);

    // publishedAt is set the first time a version becomes issuable and is never
    // cleared by archiving: when it was published is a fact about the past.
    const publishing = patch.isActive === true;

    if (!mustFork) {
      const row = await tx.certificateTemplate.update({
        where: { id: existing.id },
        data: {
          ...patch,
          type: patch.type as never,
          // Zod infers an unknown-valued record, which Prisma's InputJsonValue
          // does not accept directly — the same cast the issue route makes.
          variables: patch.variables as Prisma.InputJsonValue | undefined,
          ...(publishing ? { publishedAt: new Date() } : {}),
        },
        select: { id: true, version: true, name: true },
      });

      return { ok: true as const, forked: false, template: row };
    }

    const root = lineageRootId(existing);

    // The highest version in this lineage, not existing.version + 1: an
    // administrator may be editing an older version, and two forks from the
    // same parent must not both claim the next number.
    const latest = await tx.certificateTemplate.aggregate({
      where: { tenantId, OR: [{ id: root }, { parentTemplateId: root }] },
      _max: { version: true },
    });

    const created = await tx.certificateTemplate.create({
      data: {
        tenantId,
        parentTemplateId: root,
        version: (latest._max.version ?? existing.version) + 1,
        name: patch.name ?? existing.name,
        type: (patch.type ?? existing.type) as never,
        htmlTemplate: patch.htmlTemplate ?? existing.htmlTemplate,
        cssStyles: patch.cssStyles ?? existing.cssStyles,
        variables: (existing.variables ?? undefined) as Prisma.InputJsonValue | undefined,
        // A fork starts wherever the edit says, defaulting to a draft. It does
        // not inherit "active": publishing the new design is a decision.
        isActive: patch.isActive ?? false,
        ...(publishing ? { publishedAt: new Date() } : {}),
      },
      select: { id: true, version: true, name: true },
    });

    return { ok: true as const, forked: true, template: created };
  });
}

/**
 * Every version of one template, newest first.
 *
 * Scoped by tenant as well as lineage: a lineage id from another university
 * resolves to nothing rather than to their history.
 */
export async function templateVersions(tenantId: string, templateId: string) {
  const row = await prisma.certificateTemplate.findFirst({
    where: { id: templateId, tenantId },
    select: { id: true, parentTemplateId: true },
  });

  if (!row) return [];

  const root = lineageRootId(row);

  const versions = await prisma.certificateTemplate.findMany({
    where: { tenantId, OR: [{ id: root }, { parentTemplateId: root }] },
    orderBy: [{ version: "desc" }],
    select: {
      id: true,
      name: true,
      version: true,
      isActive: true,
      publishedAt: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { certificates: true } },
    },
  });

  return versions;
}
