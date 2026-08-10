"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/Alert";
import { Button, buttonStyles } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Switch } from "@/components/ui/Switch";
import { useToast } from "@/providers/ToastProvider";
import { createTenant } from "@/services/tenants";
import { TemporaryPasswordDialog } from "../../users/TemporaryPasswordDialog";
import { INSTITUTION_TYPE_LABELS, TENANT_STATUS_LABELS } from "@/constants/labels";
import { INSTITUTION_TYPE_VALUES, type InstitutionType, type TenantStatus } from "@/types";

interface FormState {
  name: string;
  slug: string;
  type: InstitutionType;
  status: TenantStatus;
  contactEmail: string;
  contactPhone: string;
  website: string;
  // PRD §5.1 "Configure legal and accreditation details". These columns have
  // existed on Tenant since the first migration; no platform screen had ever
  // offered them, so the requirement was unreachable through the UI.
  accreditationNo: string;
  establishedYear: string;
  country: string;
  withAdmin: boolean;
  adminFirstName: string;
  adminLastName: string;
  adminEmail: string;
}

type FieldErrors = Partial<Record<keyof FormState, string>>;

const EMPTY_FORM: FormState = {
  name: "",
  slug: "",
  type: "UNIVERSITY",
  status: "ACTIVE",
  contactEmail: "",
  contactPhone: "",
  website: "",
  accreditationNo: "",
  establishedYear: "",
  // The Tenant column's own default, so the field shows what will be stored
  // rather than blank-meaning-IN.
  country: "IN",
  // Defaulted ON. A university with no administrator is a tenant nobody can
  // sign into, which is the state this screen exists to avoid producing.
  withAdmin: true,
  adminFirstName: "",
  adminLastName: "",
  adminEmail: "",
};

/**
 * The statuses a university may be onboarded INTO.
 *
 * ACTIVE and TRIAL only. SUSPENDED and CANCELLED both stop the tenant
 * resolving (lib/services/tenant.ts refuses them) and stop its users signing in
 * (/api/auth/login refuses them), so onboarding into either would create a
 * university that cannot be used the moment it exists. Changing to them
 * afterwards is a deliberate act and belongs on the detail page.
 */
const STATUS_OPTIONS: { value: TenantStatus; label: string }[] = [
  { value: "ACTIVE", label: TENANT_STATUS_LABELS.ACTIVE },
  { value: "TRIAL", label: TENANT_STATUS_LABELS.TRIAL },
];

/**
 * The slug becomes a DNS label.
 *
 * lib/services/tenant.ts resolves the active tenant by stripping the root
 * domain off the Host header, so a slug with dots, capitals or spaces produces
 * an unroutable subdomain. Same pattern the backend's Zod schema enforces —
 * checked here too so the message lands on the field rather than arriving as a
 * generic "Invalid input".
 */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_SLUG_LENGTH = 63;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH);
}

function validate(form: FormState): FieldErrors {
  const errors: FieldErrors = {};

  if (!form.name.trim()) errors.name = "Enter the university's name.";

  if (!form.slug.trim()) {
    errors.slug = "Enter a university code.";
  } else if (form.slug.length > MAX_SLUG_LENGTH) {
    errors.slug = `Use at most ${MAX_SLUG_LENGTH} characters.`;
  } else if (!SLUG_PATTERN.test(form.slug)) {
    errors.slug = "Use lowercase letters, numbers and single hyphens only.";
  }

  // Optional, but validated when supplied — the API rejects a malformed value
  // outright rather than storing it.
  if (form.contactEmail.trim() && !EMAIL_PATTERN.test(form.contactEmail.trim())) {
    errors.contactEmail = "Enter a valid email address.";
  }
  if (form.website.trim() && !/^https?:\/\/\S+$/.test(form.website.trim())) {
    errors.website = "Enter a full URL, starting with http:// or https://.";
  }

  // Bounded rather than merely numeric: the API takes any integer, and a
  // typo'd 20226 stored as an establishment year is silently wrong forever.
  if (form.establishedYear.trim()) {
    const year = Number(form.establishedYear);
    const thisYear = new Date().getFullYear();
    if (!Number.isInteger(year) || year < 1800 || year > thisYear) {
      errors.establishedYear = `Enter a year between 1800 and ${thisYear}.`;
    }
  }

  if (form.withAdmin) {
    if (!form.adminFirstName.trim()) errors.adminFirstName = "Enter a first name.";
    if (!form.adminLastName.trim()) errors.adminLastName = "Enter a last name.";
    if (!form.adminEmail.trim()) {
      errors.adminEmail = "Enter an email address.";
    } else if (!EMAIL_PATTERN.test(form.adminEmail.trim())) {
      errors.adminEmail = "Enter a valid email address.";
    }
  }

  return errors;
}

/**
 * Onboard a university and its first administrator (W1.4).
 *
 * A full page rather than the modal this replaces, for two reasons: the form is
 * now two related sections rather than five fields, and it can end by producing
 * a credential that must be read and handed over before the screen is left — a
 * modal that closes into a refreshed list is the wrong shape for that.
 *
 * ONE REQUEST, NOT TWO
 *   The university and its administrator are submitted together and the backend
 *   writes them in one transaction. Posting the tenant and then the admin would
 *   leave a university with no way in whenever the second call failed, and the
 *   list would show it as perfectly healthy.
 *
 * NO PASSWORD FIELD
 *   The API generates one and returns it once. A platform operator does not
 *   choose a university's password.
 */
export function ProvisionUniversityForm() {
  const router = useRouter();
  const { toast } = useToast();

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // True once the code has been edited by hand, after which the name no longer
  // overwrites it — silently rewriting a deliberate choice is worse than an
  // occasional stale suggestion.
  const [slugTouched, setSlugTouched] = useState(false);
  const [provisioned, setProvisioned] = useState<{
    tenantId: string;
    email: string;
    password: string;
  } | null>(null);

  function updateField<K extends keyof FormState>(field: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [field]: value }));
    setFieldErrors((prev) => (prev[field] ? { ...prev, [field]: undefined } : prev));
  }

  function handleNameChange(name: string) {
    setForm((prev) => ({ ...prev, name, slug: slugTouched ? prev.slug : slugify(name) }));
    setFieldErrors((prev) =>
      prev.name || prev.slug ? { ...prev, name: undefined, slug: undefined } : prev
    );
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);

    const errors = validate(form);
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setIsSubmitting(true);

    const result = await createTenant({
      name: form.name.trim(),
      slug: form.slug.trim(),
      type: form.type,
      status: form.status,
      // Omitted rather than sent empty: the API's schema rejects "" for an
      // optional email, phone or URL, where an absent key lets the column
      // default apply.
      contactEmail: form.contactEmail.trim() || undefined,
      contactPhone: form.contactPhone.trim() || undefined,
      website: form.website.trim() || undefined,
      accreditationNo: form.accreditationNo.trim() || undefined,
      establishedYear: form.establishedYear.trim()
        ? Number(form.establishedYear)
        : undefined,
      country: form.country.trim() || undefined,
      admin: form.withAdmin
        ? {
            firstName: form.adminFirstName.trim(),
            lastName: form.adminLastName.trim(),
            // Lowercased to match what the API stores and what the tenant login
            // route looks up, so one address cannot become two accounts.
            email: form.adminEmail.trim().toLowerCase(),
          }
        : undefined,
    });

    setIsSubmitting(false);

    if (!result.success) {
      // The one deliberate exception to "no component inspects an error code":
      // a slug clash is a field-level problem, and resolveUiState would collapse
      // CONFLICT into a page-level error that loses which field it is about.
      if (result.code === "CONFLICT") {
        setFieldErrors({ slug: "That university code is already taken." });
        return;
      }
      setFormError(result.error);
      return;
    }

    toast({ variant: "success", title: `${result.data.tenant.name} provisioned` });

    // The success path deliberately does NOT navigate while a password is on
    // screen: navigating would replace the only copy of a value that cannot be
    // retrieved again.
    if (result.data.admin && result.data.temporaryPassword) {
      setProvisioned({
        tenantId: result.data.tenant.id,
        email: result.data.admin.email,
        password: result.data.temporaryPassword,
      });
      return;
    }

    router.push(`/platform/tenants/${result.data.tenant.id}`);
    router.refresh();
  }

  return (
    <>
      <form onSubmit={handleSubmit} className="flex flex-col gap-6" noValidate>
        {formError && <Alert variant="error">{formError}</Alert>}

        <Card>
          <h2 className="text-sm font-semibold text-heading">University</h2>
          <div className="mt-4 flex max-w-lg flex-col gap-4">
            <Input
              label="University name"
              required
              value={form.name}
              onChange={(e) => handleNameChange(e.target.value)}
              error={fieldErrors.name}
              placeholder="Dr. A.P.J. Abdul Kalam Technical University"
              autoFocus
            />

            <Input
              label="University code"
              required
              value={form.slug}
              onChange={(e) => {
                setSlugTouched(true);
                updateField("slug", e.target.value);
              }}
              error={fieldErrors.slug}
              placeholder="aktu"
              helperText="Used for the subdomain and at sign-in. Lowercase, hyphens allowed. Must be unique."
            />

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Select
                label="Type"
                value={form.type}
                onChange={(value) => updateField("type", value as InstitutionType)}
                options={INSTITUTION_TYPE_VALUES.map((value) => ({
                  value,
                  label: INSTITUTION_TYPE_LABELS[value],
                }))}
              />
              <Select
                label="Status"
                value={form.status}
                onChange={(value) => updateField("status", value as TenantStatus)}
                options={STATUS_OPTIONS}
                helperText="Suspending or cancelling is done afterwards, from the university's page."
              />
            </div>

            <Input
              label="Contact email"
              type="email"
              value={form.contactEmail}
              onChange={(e) => updateField("contactEmail", e.target.value)}
              error={fieldErrors.contactEmail}
              placeholder="registrar@aktu.ac.in"
            />

            <Input
              label="Contact phone"
              value={form.contactPhone}
              onChange={(e) => updateField("contactPhone", e.target.value)}
              placeholder="+91 98765 43210"
            />

            <Input
              label="Website"
              value={form.website}
              onChange={(e) => updateField("website", e.target.value)}
              error={fieldErrors.website}
              placeholder="https://aktu.ac.in"
            />
          </div>
        </Card>

        {/* PRD §5.1 "Configure legal and accreditation details". */}
        <Card>
          <h2 className="text-sm font-semibold text-heading">Legal and accreditation</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Recorded on the institution and shown on its profile. All optional — they can be
            added later from the university&apos;s page.
          </p>

          <div className="mt-4 grid max-w-lg grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label="Accreditation number"
              value={form.accreditationNo}
              onChange={(e) => updateField("accreditationNo", e.target.value)}
              placeholder="NAAC-A++-2026"
            />
            <Input
              label="Established year"
              inputMode="numeric"
              value={form.establishedYear}
              onChange={(e) => updateField("establishedYear", e.target.value)}
              error={fieldErrors.establishedYear}
              placeholder="1998"
            />
            <Input
              label="Country"
              value={form.country}
              onChange={(e) => updateField("country", e.target.value)}
              helperText="Two-letter code. Defaults to IN."
            />
          </div>
        </Card>

        <Card>
          <h2 className="text-sm font-semibold text-heading">First administrator</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Created inside this university with the UNIVERSITY_ADMIN role. They sign in at the
            normal university login and can only ever see their own institution.
          </p>

          <div className="mt-4 flex max-w-lg flex-col gap-4">
            <Switch
              label="Create the first administrator now"
              checked={form.withAdmin}
              onChange={(e) => updateField("withAdmin", e.target.checked)}
              helperText="Without one, nobody can sign in to this university until an administrator is added from its page."
            />

            {form.withAdmin && (
              <>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Input
                    label="First name"
                    required
                    value={form.adminFirstName}
                    onChange={(e) => updateField("adminFirstName", e.target.value)}
                    error={fieldErrors.adminFirstName}
                  />
                  <Input
                    label="Last name"
                    required
                    value={form.adminLastName}
                    onChange={(e) => updateField("adminLastName", e.target.value)}
                    error={fieldErrors.adminLastName}
                  />
                </div>

                <Input
                  label="Email"
                  type="email"
                  required
                  value={form.adminEmail}
                  onChange={(e) => updateField("adminEmail", e.target.value)}
                  error={fieldErrors.adminEmail}
                  helperText="The address they sign in with, at this university."
                />

                <Alert variant="info">
                  A temporary password is generated and shown to you once. They must replace it
                  before they can use the console.
                </Alert>
              </>
            )}
          </div>
        </Card>

        <div className="flex gap-2">
          <Button type="submit" isLoading={isSubmitting}>
            Provision university
          </Button>
          <Link href="/platform/tenants" className={buttonStyles({ variant: "secondary" })}>
            Cancel
          </Link>
        </div>
      </form>

      {provisioned && (
        <TemporaryPasswordDialog
          isOpen
          email={provisioned.email}
          password={provisioned.password}
          // Only now is it safe to leave: the password has been dismissed
          // deliberately rather than navigated away from.
          onClose={() => {
            const { tenantId } = provisioned;
            setProvisioned(null);
            router.push(`/platform/tenants/${tenantId}`);
            router.refresh();
          }}
        />
      )}
    </>
  );
}
