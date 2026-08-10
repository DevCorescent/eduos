"use server";

// ============================================================================
// MODULE : Actions — Tenant Domains and Branding (WP-3)
// PURPOSE: The writes both configuration screens perform, as Server Actions.
// ============================================================================

import {
  createTenantDomain,
  deleteTenantDomain,
  updateMyBranding,
  updateTenantDomain,
} from "@/services/branding";
import type { FormValues } from "@/components/shared/EntityFormModal";
import type { DomainType } from "@/app/generated/prisma/enums";
import type { ActionResult } from "./setup";

/** An empty text input means "cleared", not an empty string. */
function optionalText(values: FormValues, key: string): string | null {
  const value = String(values[key] ?? "").trim();
  return value === "" ? null : value;
}

export async function createDomainAction(
  tenantId: string,
  values: FormValues
): Promise<ActionResult> {
  const result = await createTenantDomain(tenantId, {
    domain: String(values.domain ?? "").trim(),
    type: String(values.type) as DomainType,
    verified: Boolean(values.verified),
    isPrimary: Boolean(values.isPrimary),
    isActive: Boolean(values.isActive),
  });

  // A taken hostname or an existing canonical domain — both are conflicts the
  // reader fixes by changing a field, so the message goes on that field.
  if (!result.success && result.code === "CONFLICT") {
    return { ...result, field: "domain" };
  }

  return result;
}

export async function updateDomainAction(
  tenantId: string,
  domainId: string,
  values: FormValues
): Promise<ActionResult> {
  return updateTenantDomain(tenantId, domainId, {
    type: String(values.type) as DomainType,
    verified: Boolean(values.verified),
    isPrimary: Boolean(values.isPrimary),
    isActive: Boolean(values.isActive),
  });
}

export async function deleteDomainAction(
  tenantId: string,
  domainId: string
): Promise<ActionResult> {
  return deleteTenantDomain(tenantId, domainId);
}

/**
 * Update this university's branding.
 *
 * Every field is sent, including cleared ones as null, so emptying a colour
 * genuinely removes it rather than leaving the previous value in place.
 */
export async function updateBrandingAction(values: FormValues): Promise<ActionResult> {
  return updateMyBranding({
    logoUrl: optionalText(values, "logoUrl"),
    faviconUrl: optionalText(values, "faviconUrl"),
    primaryColor: optionalText(values, "primaryColor"),
    accentColor: optionalText(values, "accentColor"),
  });
}
