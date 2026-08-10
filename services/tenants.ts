// ============================================================================
// MODULE : Services — Tenants
// PURPOSE: Every tenant read and write the platform console performs.
//
//          The live branch of each function names the key the route nests its
//          rows under ("tenants"), which apiList normalises to `items`. That
//          one string is the whole of the backend's per-entity list shape, and
//          it is confined here — no page sees it.
// ============================================================================

import type {
  ApiResponse,
  ListParams,
  PaginatedResult,
  Tenant,
  TenantAdmin,
  TenantStats,
} from "@/types";
import { apiList, apiRequest } from "./client";

/**
 * Writable fields on create. Mirrors createTenantSchema.
 *
 * W1.5 adds the legal and accreditation columns PRD §5.1 names ("Configure
 * legal and accreditation details"). They existed on Tenant and in the backend
 * schema all along — no platform screen had ever offered them.
 */
export interface CreateTenantInput {
  slug: string;
  name: string;
  type?: Tenant["type"];
  contactEmail?: string;
  contactPhone?: string;
  website?: string;
  establishedYear?: number;
  accreditationNo?: string;
  country?: string;
  timezone?: string;
  locale?: string;
}

/**
 * Writable fields on update. Every key optional; `status` and
 * `supportManagerId` are update-only.
 *
 * `supportManagerId` is nullable so an assignment can be cleared — PRD §5.1
 * "Assign support manager". `null` unassigns; omitting the key leaves it alone.
 */
export type UpdateTenantInput = Partial<CreateTenantInput> & {
  status?: Tenant["status"];
  supportManagerId?: string | null;
};

/**
 * One page of tenants.
 *
 * `q` searches name and slug, and `status`/`type` filter exactly. The live API
 * implements none of these yet — every route's VALIDATION note says no search
 * parameter is defined — so they are honoured by the mock and sent-and-ignored
 * against the real backend. Nothing breaks either way: Zod's object parsing
 * drops an unknown search param rather than rejecting the request.
 */
export async function listTenants(
  params?: ListParams
): Promise<ApiResponse<PaginatedResult<Tenant>>> {
  return apiList<Tenant>("/api/platform/tenants", "tenants", params);
}

export async function getTenant(id: string): Promise<ApiResponse<Tenant>> {
  return apiRequest<Tenant>(`/api/platform/tenants/${id}`);
}

/**
 * Student and faculty counts for one tenant.
 *
 * The live endpoint returns counts only — it deliberately produces no revenue
 * figure, because the README names the category without defining it. The mock
 * matches that shape exactly rather than inventing the missing metric.
 */
export async function getTenantStats(id: string): Promise<ApiResponse<TenantStats>> {
  return apiRequest<TenantStats>(`/api/platform/tenants/${id}/stats`);
}

/** The initial University Admin, as supplied when provisioning (W1.4). */
export interface ProvisionAdminInput {
  firstName: string;
  lastName: string;
  email: string;
}

/**
 * What provisioning hands back.
 *
 * `admin` and `temporaryPassword` are null when no administrator was requested.
 * The plaintext is present exactly once, in this response — it is never stored
 * and never re-fetchable, so a caller that discards it must provision a fresh
 * administrator or reset the existing one.
 */
export interface ProvisionedUniversity {
  tenant: Pick<Tenant, "id" | "slug" | "name" | "status">;
  admin: TenantAdmin | null;
  temporaryPassword: string | null;
}

/**
 * Provision a university (W1.4).
 *
 * When `admin` is supplied, the tenant, its subscription, the tenant's
 * UNIVERSITY_ADMIN role, the administrator and their role grant are created in
 * ONE transaction — so a university never exists without the administrator that
 * was requested for it, and an administrator never exists without their role.
 *
 * `status` is accepted here because W1.4 onboards real institutions directly as
 * ACTIVE; omitting it still falls back to the schema's TRIAL default.
 */
export async function createTenant(
  input: CreateTenantInput & { status?: Tenant["status"]; admin?: ProvisionAdminInput }
): Promise<ApiResponse<ProvisionedUniversity>> {
  return apiRequest<ProvisionedUniversity>("/api/platform/tenants", {
    method: "POST",
    body: input,
  });
}

/** The administrators of one university. */
export async function listTenantAdmins(
  tenantId: string
): Promise<ApiResponse<{ admins: TenantAdmin[] }>> {
  return apiRequest<{ admins: TenantAdmin[] }>(`/api/platform/tenants/${tenantId}/admins`);
}

/**
 * Provision a University Admin for a tenant that already exists.
 *
 * The same service call as onboarding, so the role grant, the generated
 * password and the forced-change flag cannot differ between the two paths.
 */
export async function provisionTenantAdmin(
  tenantId: string,
  input: ProvisionAdminInput
): Promise<ApiResponse<{ admin: TenantAdmin; temporaryPassword: string }>> {
  return apiRequest<{ admin: TenantAdmin; temporaryPassword: string }>(
    `/api/platform/tenants/${tenantId}/admins`,
    { method: "POST", body: input }
  );
}

export async function updateTenant(
  id: string,
  input: UpdateTenantInput
): Promise<ApiResponse<Tenant>> {
  return apiRequest<Tenant>(`/api/platform/tenants/${id}`, { method: "PATCH", body: input });
}

// --- W1.5 · University onboarding (PRD §5.1, §49.1) -------------------------

/** PRD §49.1, in the PRD's own order. Mirrors ONBOARDING_STAGES on the server. */
export type OnboardingStageName =
  | "UNIVERSITY_ENQUIRY"
  | "COMMERCIAL_APPROVAL"
  | "TENANT_CREATION"
  | "DOMAIN_CONFIGURATION"
  | "BRANDING_CONFIGURATION"
  | "MODULE_SELECTION"
  | "ACADEMIC_SETUP"
  | "DATA_IMPORT"
  | "USER_CREATION"
  | "TRAINING"
  | "UAT"
  | "GO_LIVE";

export interface OnboardingStageStatus {
  stage: OnboardingStageName;
  label: string;
  completed: boolean;
  completedAt: string | null;
  completedBy: string | null;
  note: string | null;
  /** null where the stage happens outside the product and cannot be observed. */
  evidence: boolean | null;
  evidenceDetail: string;
}

export interface OnboardingProgress {
  stages: OnboardingStageStatus[];
  completedCount: number;
  totalCount: number;
  dataReady: boolean;
}

export async function getOnboardingProgress(
  tenantId: string
): Promise<ApiResponse<OnboardingProgress>> {
  return apiRequest<OnboardingProgress>(`/api/platform/tenants/${tenantId}/onboarding`);
}

/** Idempotent — marking a stage twice is not an error. */
export async function markOnboardingStage(
  tenantId: string,
  stage: OnboardingStageName,
  note?: string
): Promise<ApiResponse<OnboardingProgress>> {
  return apiRequest<OnboardingProgress>(`/api/platform/tenants/${tenantId}/onboarding`, {
    method: "POST",
    body: { stage, ...(note ? { note } : {}) },
  });
}

export async function clearOnboardingStage(
  tenantId: string,
  stage: OnboardingStageName
): Promise<ApiResponse<OnboardingProgress>> {
  return apiRequest<OnboardingProgress>(`/api/platform/tenants/${tenantId}/onboarding`, {
    method: "DELETE",
    body: { stage },
  });
}

// --- W1.5 · Campuses and affiliated colleges (PRD §5.1) ---------------------

export interface TenantSchool {
  id: string;
  name: string;
  code: string;
  deanName: string | null;
  email: string | null;
}

export interface TenantCampus {
  id: string;
  tenantId: string;
  name: string;
  code: string;
  email: string | null;
  phone: string | null;
  isMain: boolean;
  createdAt: string;
  /** Affiliated colleges, in this schema's terms. */
  schools: TenantSchool[];
}

export async function listTenantCampuses(
  tenantId: string
): Promise<ApiResponse<{ campuses: TenantCampus[] }>> {
  return apiRequest<{ campuses: TenantCampus[] }>(`/api/platform/tenants/${tenantId}/campuses`);
}

export interface CreateCampusInput {
  name: string;
  code: string;
  email?: string;
  phone?: string;
  isMain?: boolean;
}

export async function createTenantCampus(
  tenantId: string,
  input: CreateCampusInput
): Promise<ApiResponse<TenantCampus>> {
  return apiRequest<TenantCampus>(`/api/platform/tenants/${tenantId}/campuses`, {
    method: "POST",
    body: input,
  });
}

// --- W1.5 · Academic year (PRD §5.1) ----------------------------------------

export interface TenantAcademicYear {
  id: string;
  tenantId: string;
  name: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
  createdAt: string;
}

export async function listTenantAcademicYears(
  tenantId: string
): Promise<ApiResponse<{ academicYears: TenantAcademicYear[] }>> {
  return apiRequest<{ academicYears: TenantAcademicYear[] }>(
    `/api/platform/tenants/${tenantId}/academic-years`
  );
}

export interface CreateAcademicYearInput {
  name: string;
  startDate: string;
  endDate: string;
  isCurrent?: boolean;
}

export async function createTenantAcademicYear(
  tenantId: string,
  input: CreateAcademicYearInput
): Promise<ApiResponse<TenantAcademicYear>> {
  return apiRequest<TenantAcademicYear>(`/api/platform/tenants/${tenantId}/academic-years`, {
    method: "POST",
    body: input,
  });
}

// --- W1.5 · Branding (PRD §5.1) ---------------------------------------------

export interface TenantBrandingConfig {
  id: string;
  name: string;
  logoUrl: string | null;
  faviconUrl: string | null;
  primaryColor: string | null;
  accentColor: string | null;
}

export async function getTenantBrandingConfig(
  tenantId: string
): Promise<ApiResponse<TenantBrandingConfig>> {
  return apiRequest<TenantBrandingConfig>(`/api/platform/tenants/${tenantId}/branding`);
}

/**
 * Update branding. `null` clears a value; an omitted key leaves it unchanged.
 *
 * URLs rather than file uploads: this project has no object storage, so a file
 * picker would be a control with nothing behind it.
 */
export async function updateTenantBrandingConfig(
  tenantId: string,
  input: Partial<Pick<TenantBrandingConfig, "logoUrl" | "faviconUrl" | "primaryColor" | "accentColor">>
): Promise<ApiResponse<TenantBrandingConfig>> {
  return apiRequest<TenantBrandingConfig>(`/api/platform/tenants/${tenantId}/branding`, {
    method: "PATCH",
    body: input,
  });
}

// --- W1.5 · Enabled modules (PRD §2.1, §5.1, §57) ---------------------------

/** One entry of the PRD §57 catalogue, as the API returns it. */
export interface ModuleDefinition {
  key: string;
  label: string;
  prdSection: string;
  alwaysOn?: boolean;
}

export interface TenantModules {
  subscriptionId: string;
  /** The catalogue, from the server — the UI never hard-codes the module list. */
  catalogue: ModuleDefinition[];
  /** Catalogue key → enabled. */
  modules: Record<string, boolean>;
  /**
   * Keys stored on the subscription that the catalogue does not recognise.
   *
   * Surfaced rather than hidden: the column predates the catalogue and holds
   * values nobody can account for. They are preserved on every write.
   */
  unknown: Record<string, unknown>;
}

export async function getTenantModules(
  tenantId: string
): Promise<ApiResponse<TenantModules>> {
  return apiRequest<TenantModules>(`/api/platform/tenants/${tenantId}/modules`);
}

/**
 * Replace the module selection.
 *
 * PUT, because the submitted map replaces the selection wholesale — the same
 * contract the underlying column has always had. Unrecognised keys are
 * preserved server-side, so the caller does not have to carry them.
 */
export async function updateTenantModules(
  tenantId: string,
  modules: Record<string, boolean>
): Promise<ApiResponse<{ modules: Record<string, boolean>; unknown: Record<string, unknown> }>> {
  return apiRequest<{ modules: Record<string, boolean>; unknown: Record<string, unknown> }>(
    `/api/platform/tenants/${tenantId}/modules`,
    { method: "PUT", body: { modules } }
  );
}

// --- W1.5 · Archival (PRD §5.1, §46.3) --------------------------------------

/**
 * Archive a university, or restore an archived one.
 *
 * Non-destructive: archiving keeps every row and stops the university serving
 * traffic through the same mechanism that already stops a suspended one.
 * Restoring returns it to SUSPENDED, not ACTIVE — putting students back online
 * is a separate, deliberate act.
 *
 * There is no delete function in this service, and that is deliberate: the PRD
 * defines no retention, export format or restore window, so the destructive
 * half of §5.1's "deletion and data archival" is not implemented.
 */
export async function archiveTenant(
  tenantId: string,
  input: { restore?: boolean; reason?: string } = {}
): Promise<ApiResponse<Pick<Tenant, "id" | "name" | "slug" | "status"> & { archivedAt: string | null }>> {
  return apiRequest<Pick<Tenant, "id" | "name" | "slug" | "status"> & { archivedAt: string | null }>(
    `/api/platform/tenants/${tenantId}/archive`,
    { method: "POST", body: input }
  );
}

// --- W1.6 · Initial university data import (PRD §5.1 #14, §54, §55) ---------

export interface ImportColumn {
  name: string;
  required: boolean;
  description: string;
  enumValues?: string[];
}

export interface ImportEntityInfo {
  key: string;
  label: string;
  model: string;
  prdSource: string;
  duplicateKey: string;
  dependsOn: string[];
  /** True when importing this entity creates User accounts and issues credentials. */
  createsUser: boolean;
  /** The existing tenant role each imported person is granted, or null. */
  roleName: string | null;
  /** Row ceiling for THIS entity — far lower for people. */
  maxRows: number;
  columns: ImportColumn[];
  /** Header row for the downloadable template. */
  templateHeaders: string[];
}

export interface ImportRowError {
  /** 1-based line in the file, matching what a spreadsheet shows. */
  line: number;
  column: string | null;
  message: string;
}

/**
 * A one-time credential for an imported person.
 *
 * Present only on a successful commit of Students, Faculty or Employees, and
 * only in that one response — the server stores nothing but the bcrypt hash, so
 * nothing can produce these again.
 */
export interface IssuedCredential {
  identifier: string;
  email: string;
  name: string;
  temporaryPassword: string;
}

export interface ImportReport {
  entity: string;
  mode: "preview" | "commit";
  totalRows: number;
  validRows: number;
  invalidRows: number;
  importedRows: number;
  skippedRows: number;
  errors: ImportRowError[];
  committed: boolean;
  credentials?: IssuedCredential[];
}

/** The importable entities and their columns — §55 Stage 3 "Data templates". */
export async function getImportEntities(
  tenantId: string
): Promise<ApiResponse<{ maxRows: number; entities: ImportEntityInfo[] }>> {
  return apiRequest<{ maxRows: number; entities: ImportEntityInfo[] }>(
    `/api/platform/tenants/${tenantId}/import`
  );
}

/**
 * Validate a CSV, or validate and import it.
 *
 * `preview` writes nothing (§55 "Test imports"); `commit` writes in one
 * transaction (§55 "Final migration"). Both run the same validation server-side,
 * so a preview cannot disagree with the import that follows it.
 */
export async function runTenantImport(
  tenantId: string,
  input: { entity: string; csv: string; mode: "preview" | "commit" }
): Promise<ApiResponse<ImportReport>> {
  return apiRequest<ImportReport>(`/api/platform/tenants/${tenantId}/import`, {
    method: "POST",
    body: input,
  });
}

// --- W3 · Programmes, read-only, for the admission form ---------------------

export interface TenantProgramme {
  id: string;
  code: string;
  name: string;
}

/**
 * A university's active programmes.
 *
 * Read-only and platform-guarded. The admission form offers these rather than a
 * hardcoded list; programme MANAGEMENT stays with the university's own console.
 */
export async function listTenantProgrammes(
  tenantId: string
): Promise<ApiResponse<{ programmes: TenantProgramme[] }>> {
  return apiRequest<{ programmes: TenantProgramme[] }>(
    `/api/platform/tenants/${tenantId}/programmes`
  );
}
