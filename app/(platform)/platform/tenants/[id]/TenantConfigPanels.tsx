"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Building2, CalendarRange, Palette } from "lucide-react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Switch } from "@/components/ui/Switch";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/layout/EmptyState";
import { StateView } from "@/components/shared/StateView";
import { useDisclosure } from "@/hooks/useDisclosure";
import { useToast } from "@/providers/ToastProvider";
import { ColourField } from "@/components/ui/ColourField";
import {
  createTenantAcademicYear,
  createTenantCampus,
  updateTenantBrandingConfig,
  type TenantAcademicYear,
  type TenantBrandingConfig,
  type TenantCampus,
} from "@/services/tenants";
import { formatDate } from "@/utils/format";

export interface TenantConfigPanelsProps {
  tenantId: string;
  campuses: TenantCampus[] | null;
  campusesError: string | null;
  academicYears: TenantAcademicYear[] | null;
  academicYearsError: string | null;
  branding: TenantBrandingConfig | null;
  brandingError: string | null;
}

/**
 * The three §5.1 configuration surfaces a platform operator needs during
 * onboarding: campuses and affiliated colleges, academic year, and branding.
 *
 * WHY THESE ARE HERE AND NOT LINKED TO THE UNIVERSITY'S OWN SCREENS
 *   The university's console already has all three. A platform operator cannot
 *   open them: those screens are served from the tenant's hostname and their
 *   APIs are guarded by requireRole + requireTenant, which a platform session
 *   can never satisfy. §5.1 places this configuration in the Super Admin panel
 *   because it happens during onboarding, before the university has anybody to
 *   do it themselves. These panels call the platform-guarded routes over the
 *   same rows.
 *
 * Each panel degrades on its own: a failure in one shows an error there and
 * leaves the other two working, because none of them depends on the others.
 */
export function TenantConfigPanels({
  tenantId,
  campuses,
  campusesError,
  academicYears,
  academicYearsError,
  branding,
  brandingError,
}: TenantConfigPanelsProps) {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <CampusPanel tenantId={tenantId} campuses={campuses} error={campusesError} />
      <AcademicYearPanel tenantId={tenantId} years={academicYears} error={academicYearsError} />
      <div className="lg:col-span-2">
        <BrandingPanel tenantId={tenantId} branding={branding} error={brandingError} />
      </div>
    </div>
  );
}

// --- Campuses and affiliated colleges ---------------------------------------

function CampusPanel({
  tenantId,
  campuses,
  error,
}: {
  tenantId: string;
  campuses: TenantCampus[] | null;
  error: string | null;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const modal = useDisclosure();
  const [form, setForm] = useState({ name: "", code: "", email: "", isMain: false });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function close() {
    modal.close();
    setForm({ name: "", code: "", email: "", isMain: false });
    setFieldErrors({});
    setFormError(null);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);

    const errors: Record<string, string> = {};
    if (!form.name.trim()) errors.name = "Enter a campus name.";
    if (!form.code.trim()) errors.code = "Enter a campus code.";
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setIsSubmitting(true);
    const result = await createTenantCampus(tenantId, {
      name: form.name.trim(),
      code: form.code.trim(),
      // Omitted rather than sent empty: the API rejects "" for an optional
      // email, where an absent key lets the column stay null.
      email: form.email.trim() || undefined,
      isMain: form.isMain,
    });
    setIsSubmitting(false);

    if (!result.success) {
      if (result.code === "CONFLICT") {
        setFieldErrors({ code: "That campus code is already used in this university." });
        return;
      }
      setFormError(result.error);
      return;
    }

    toast({ variant: "success", title: `${result.data.name} added` });
    close();
    router.refresh();
  }

  return (
    <>
      <Card>
        <PanelHeader
          title="Campuses and affiliated colleges"
          subtitle="Campuses, with the colleges affiliated to each."
          action={
            <Button size="sm" variant="secondary" onClick={modal.open}>
              Add campus
            </Button>
          }
        />

        {error ? (
          <StateView state="error" subject="campuses" message={error} className="mt-3" />
        ) : campuses && campuses.length > 0 ? (
          <ul className="mt-3 divide-y divide-border">
            {campuses.map((campus) => (
              <li key={campus.id} className="py-3">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-foreground">{campus.name}</p>
                  <span className="font-mono text-xs text-muted-foreground">{campus.code}</span>
                  {campus.isMain && (
                    <Badge variant="info" size="sm" withDot={false}>
                      Main
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {campus.schools.length === 0
                    ? "No affiliated colleges"
                    : `${campus.schools.length} affiliated: ${campus.schools
                        .map((s) => s.name)
                        .join(", ")}`}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            icon={<Building2 />}
            title="No campuses"
            description="Add the university's main campus to begin its structure."
            className="mt-3"
          />
        )}
      </Card>

      <Modal
        isOpen={modal.isOpen}
        onClose={close}
        title="Add a campus"
        description="Affiliated colleges are added to a campus from the university's own console."
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={close} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type="submit" form="add-campus-form" isLoading={isSubmitting}>
              Add campus
            </Button>
          </div>
        }
      >
        {formError && (
          <Alert variant="error" className="mb-4">
            {formError}
          </Alert>
        )}
        <form id="add-campus-form" onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <Input
            label="Campus name"
            required
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            error={fieldErrors.name}
            placeholder="Main Campus"
            autoFocus
          />
          <Input
            label="Campus code"
            required
            value={form.code}
            onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
            error={fieldErrors.code}
            placeholder="MAIN"
            helperText="Unique within this university."
          />
          <Input
            label="Email"
            type="email"
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
          />
          <Switch
            label="Main campus"
            checked={form.isMain}
            onChange={(e) => setForm((f) => ({ ...f, isMain: e.target.checked }))}
            helperText="Setting this clears the flag on the current main campus."
          />
        </form>
      </Modal>
    </>
  );
}

// --- Academic year ----------------------------------------------------------

function AcademicYearPanel({
  tenantId,
  years,
  error,
}: {
  tenantId: string;
  years: TenantAcademicYear[] | null;
  error: string | null;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const modal = useDisclosure();
  const [form, setForm] = useState({ name: "", startDate: "", endDate: "", isCurrent: true });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function close() {
    modal.close();
    setForm({ name: "", startDate: "", endDate: "", isCurrent: true });
    setFieldErrors({});
    setFormError(null);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);

    const errors: Record<string, string> = {};
    if (!form.name.trim()) errors.name = "Enter a name, such as 2026-27.";
    if (!form.startDate) errors.startDate = "Choose a start date.";
    if (!form.endDate) errors.endDate = "Choose an end date.";
    // Checked here as well as server-side: an inverted year silently breaks
    // every semester and batch hung off it, and the message belongs on the field.
    if (form.startDate && form.endDate && form.endDate <= form.startDate) {
      errors.endDate = "The end date must be after the start date.";
    }
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setIsSubmitting(true);
    const result = await createTenantAcademicYear(tenantId, {
      name: form.name.trim(),
      startDate: form.startDate,
      endDate: form.endDate,
      isCurrent: form.isCurrent,
    });
    setIsSubmitting(false);

    if (!result.success) {
      if (result.code === "CONFLICT") {
        setFieldErrors({ name: "That academic year already exists in this university." });
        return;
      }
      setFormError(result.error);
      return;
    }

    toast({ variant: "success", title: `${result.data.name} added` });
    close();
    router.refresh();
  }

  return (
    <>
      <Card>
        <PanelHeader
          title="Academic year"
          subtitle="The years semesters and batches are organised under."
          action={
            <Button size="sm" variant="secondary" onClick={modal.open}>
              Add year
            </Button>
          }
        />

        {error ? (
          <StateView state="error" subject="academic years" message={error} className="mt-3" />
        ) : years && years.length > 0 ? (
          <ul className="mt-3 divide-y divide-border">
            {years.map((year) => (
              <li key={year.id} className="flex items-center justify-between gap-3 py-3">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-foreground">{year.name}</p>
                    {year.isCurrent && (
                      <Badge variant="success" size="sm" withDot={false}>
                        Current
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(year.startDate)} — {formatDate(year.endDate)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            icon={<CalendarRange />}
            title="No academic year"
            description="Semesters, batches and admissions all hang off an academic year."
            className="mt-3"
          />
        )}
      </Card>

      <Modal
        isOpen={modal.isOpen}
        onClose={close}
        title="Add an academic year"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={close} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type="submit" form="add-year-form" isLoading={isSubmitting}>
              Add year
            </Button>
          </div>
        }
      >
        {formError && (
          <Alert variant="error" className="mb-4">
            {formError}
          </Alert>
        )}
        <form id="add-year-form" onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <Input
            label="Name"
            required
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            error={fieldErrors.name}
            placeholder="2026-27"
            autoFocus
          />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label="Start date"
              type="date"
              required
              value={form.startDate}
              onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
              error={fieldErrors.startDate}
            />
            <Input
              label="End date"
              type="date"
              required
              value={form.endDate}
              onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))}
              error={fieldErrors.endDate}
            />
          </div>
          <Switch
            label="Current academic year"
            checked={form.isCurrent}
            onChange={(e) => setForm((f) => ({ ...f, isCurrent: e.target.checked }))}
            helperText="Setting this clears the flag on the current year."
          />
        </form>
      </Modal>
    </>
  );
}

// --- Branding ---------------------------------------------------------------

function BrandingPanel({
  tenantId,
  branding,
  error,
}: {
  tenantId: string;
  branding: TenantBrandingConfig | null;
  error: string | null;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [form, setForm] = useState({
    logoUrl: branding?.logoUrl ?? "",
    faviconUrl: branding?.faviconUrl ?? "",
    primaryColor: branding?.primaryColor ?? "",
    accentColor: branding?.accentColor ?? "",
  });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

  if (error || !branding) {
    return (
      <Card>
        <PanelHeader title="Branding" subtitle="Logo, favicon and colours." />
        <StateView state="error" subject="branding" message={error ?? undefined} className="mt-3" />
      </Card>
    );
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setFormError(null);

    const errors: Record<string, string> = {};
    if (form.primaryColor && !HEX.test(form.primaryColor)) {
      errors.primaryColor = "Use a hex colour, such as #1d4ed8.";
    }
    if (form.accentColor && !HEX.test(form.accentColor)) {
      errors.accentColor = "Use a hex colour, such as #f59e0b.";
    }
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setIsSaving(true);
    // Empty string means "clear this", which the API expresses as null — an
    // empty string would fail URL validation and is not what the box means.
    const result = await updateTenantBrandingConfig(tenantId, {
      logoUrl: form.logoUrl.trim() || null,
      faviconUrl: form.faviconUrl.trim() || null,
      primaryColor: form.primaryColor.trim() || null,
      accentColor: form.accentColor.trim() || null,
    });
    setIsSaving(false);

    if (!result.success) {
      setFormError(result.error);
      return;
    }

    toast({ variant: "success", title: "Branding updated" });
    router.refresh();
  }

  return (
    <Card>
      <PanelHeader
        title="Branding"
        subtitle="Applied across this university's portals and sign-in page."
      />

      {formError && (
        <Alert variant="error" className="mt-3">
          {formError}
        </Alert>
      )}

      <form onSubmit={save} className="mt-4 flex flex-col gap-4" noValidate>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="Logo URL"
            value={form.logoUrl}
            onChange={(e) => setForm((f) => ({ ...f, logoUrl: e.target.value }))}
            placeholder="https://cdn.example.com/logo.svg"
            // Named plainly rather than shown as a file picker that would have
            // nothing behind it — this project has no object storage.
            helperText="A URL. There is no file storage in this build, so images are linked, not uploaded."
          />
          <Input
            label="Favicon URL"
            value={form.faviconUrl}
            onChange={(e) => setForm((f) => ({ ...f, faviconUrl: e.target.value }))}
            placeholder="https://cdn.example.com/favicon.ico"
          />
          <ColourField
            label="Primary colour"
            value={form.primaryColor}
            onChange={(value) => setForm((f) => ({ ...f, primaryColor: value }))}
            error={fieldErrors.primaryColor}
            placeholder="#1d4ed8"
          />
          <ColourField
            label="Accent colour"
            value={form.accentColor}
            onChange={(value) => setForm((f) => ({ ...f, accentColor: value }))}
            error={fieldErrors.accentColor}
            placeholder="#f59e0b"
          />
        </div>

        <div className="flex items-center gap-3">
          {/* The two unlabelled swatches that used to sit here are gone: each
              colour now shows its own swatch beside its own label, which says
              WHICH colour it is. Two indicators for the same value, one of them
              anonymous, is worse than one that is named. */}
          <Button type="submit" isLoading={isSaving} leftIcon={<Palette className="size-4" />}>
            Save branding
          </Button>
        </div>
      </form>
    </Card>
  );
}

// --- Shared -----------------------------------------------------------------

function PanelHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-sm font-semibold text-heading">{title}</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>
      </div>
      {action}
    </div>
  );
}
