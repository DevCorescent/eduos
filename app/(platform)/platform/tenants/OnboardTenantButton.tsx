"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import { Alert } from "@/components/ui/Alert";
import { useDisclosure } from "@/hooks/useDisclosure";
import { useToast } from "@/providers/ToastProvider";
import { createTenant } from "@/services/tenants";
import { INSTITUTION_TYPE_LABELS } from "@/constants/labels";
import { INSTITUTION_TYPE_VALUES, type InstitutionType } from "@/types";

interface OnboardForm {
  name: string;
  slug: string;
  type: InstitutionType;
  contactEmail: string;
  contactPhone: string;
}

type FieldErrors = Partial<Record<keyof OnboardForm, string>>;

const EMPTY_FORM: OnboardForm = {
  name: "",
  slug: "",
  type: "UNIVERSITY",
  contactEmail: "",
  contactPhone: "",
};

/**
 * The slug becomes a DNS label.
 *
 * lib/services/tenant.ts resolves the active tenant by stripping the root
 * domain off the Host header, so a slug with dots, capitals or spaces produces
 * an unroutable subdomain. This is the same pattern the backend's Zod schema
 * enforces — checked here as well so the message lands on the field rather than
 * arriving as a generic "Invalid input" from the API.
 */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_SLUG_LENGTH = 63;

/** Derive a suggested slug from the institution's name. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH);
}

function validate(form: OnboardForm): FieldErrors {
  const errors: FieldErrors = {};

  if (!form.name.trim()) {
    errors.name = "Enter the institution's name.";
  }

  if (!form.slug.trim()) {
    errors.slug = "Enter an institution code.";
  } else if (form.slug.length > MAX_SLUG_LENGTH) {
    errors.slug = `Use at most ${MAX_SLUG_LENGTH} characters.`;
  } else if (!SLUG_PATTERN.test(form.slug)) {
    errors.slug = "Use lowercase letters, numbers and single hyphens only.";
  }

  // Optional, but validated when supplied — the API rejects a malformed address
  // outright rather than storing it.
  if (form.contactEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.contactEmail.trim())) {
    errors.contactEmail = "Enter a valid email address.";
  }

  return errors;
}

/**
 * "Onboard institution" — button plus its modal.
 *
 * Kept as one component rather than a button in the page and a modal elsewhere,
 * because the open state belongs to the pair. The page stays a Server
 * Component and simply renders this.
 *
 * On success it calls router.refresh(), which re-runs the server page and
 * re-fetches the list. That is the whole reason the list is not held in client
 * state: there is no cache to invalidate by hand and no risk of the table and
 * the server disagreeing.
 */
export function OnboardTenantButton() {
  const router = useRouter();
  const { toast } = useToast();
  const modal = useDisclosure();

  const [form, setForm] = useState<OnboardForm>(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // True once the code has been edited by hand, after which the name no longer
  // overwrites it — silently rewriting a deliberate choice is worse than an
  // occasional stale suggestion.
  const [slugTouched, setSlugTouched] = useState(false);

  function updateField<K extends keyof OnboardForm>(field: K, value: OnboardForm[K]) {
    setForm((prev) => ({ ...prev, [field]: value }));
    setFieldErrors((prev) => (prev[field] ? { ...prev, [field]: undefined } : prev));
  }

  function handleNameChange(name: string) {
    setForm((prev) => ({
      ...prev,
      name,
      slug: slugTouched ? prev.slug : slugify(name),
    }));
    setFieldErrors((prev) => (prev.name || prev.slug ? { ...prev, name: undefined, slug: undefined } : prev));
  }

  function close() {
    modal.close();
    // Reset on close so reopening starts clean rather than showing the last
    // attempt's values and errors.
    setForm(EMPTY_FORM);
    setFieldErrors({});
    setFormError(null);
    setSlugTouched(false);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
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
      // Omitted rather than sent empty: the API's schema rejects "" for an
      // optional email or phone, where an absent key lets the column default.
      contactEmail: form.contactEmail.trim() || undefined,
      contactPhone: form.contactPhone.trim() || undefined,
    });

    setIsSubmitting(false);

    if (!result.success) {
      // A slug clash is the one conflict this endpoint returns, and it belongs
      // on the field the user has to change — not in a banner above the form.
      if (result.code === "CONFLICT") {
        setFieldErrors({ slug: "That institution code is already taken." });
        return;
      }
      setFormError(result.error);
      return;
    }

    toast({
      variant: "success",
      title: "Institution onboarded",
      description: `${result.data.name} is now on a trial plan.`,
    });

    close();
    router.refresh();
  }

  return (
    <>
      <Button leftIcon={<Plus className="size-4" />} onClick={modal.open}>
        Onboard institution
      </Button>

      <Modal
        isOpen={modal.isOpen}
        onClose={close}
        title="Onboard an institution"
        description="Creates a tenant on a trial plan. Plan and status are managed afterwards."
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={close} disabled={isSubmitting}>
              Cancel
            </Button>
            {/* Submits the form by id, since the footer sits outside <form>. */}
            <Button type="submit" form="onboard-tenant-form" isLoading={isSubmitting}>
              Onboard
            </Button>
          </div>
        }
      >
        {formError && (
          <Alert variant="error" className="mb-4">
            {formError}
          </Alert>
        )}

        <form id="onboard-tenant-form" onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
          <Input
            label="Institution Name"
            required
            value={form.name}
            onChange={(e) => handleNameChange(e.target.value)}
            error={fieldErrors.name}
            placeholder="Verify University"
            autoFocus
          />

          <Input
            label="Institution Code"
            required
            value={form.slug}
            onChange={(e) => {
              setSlugTouched(true);
              updateField("slug", e.target.value);
            }}
            error={fieldErrors.slug}
            placeholder="verify-university"
            helperText="Used for the subdomain and at sign-in. Lowercase, hyphens allowed."
          />

          <Select
            label="Type"
            value={form.type}
            onChange={(value) => updateField("type", value as InstitutionType)}
            options={INSTITUTION_TYPE_VALUES.map((value) => ({
              value,
              label: INSTITUTION_TYPE_LABELS[value],
            }))}
          />

          <Input
            label="Contact Email"
            type="email"
            value={form.contactEmail}
            onChange={(e) => updateField("contactEmail", e.target.value)}
            error={fieldErrors.contactEmail}
            placeholder="registrar@university.edu"
          />

          <Input
            label="Contact Phone"
            value={form.contactPhone}
            onChange={(e) => updateField("contactPhone", e.target.value)}
            placeholder="+91 98765 43210"
          />
        </form>
      </Modal>
    </>
  );
}
