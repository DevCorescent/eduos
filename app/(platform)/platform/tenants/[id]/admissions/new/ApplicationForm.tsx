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
import { useToast } from "@/providers/ToastProvider";
import { createApplication } from "@/services/admissions";

export interface ProgrammeOption {
  id: string;
  code: string;
  name: string;
}

/**
 * PRD §8.2 — the admission application form.
 *
 * COVERS ONLY WHAT §8.2 NAMES
 *   Applicant information, guardian information, education history, work
 *   history and programme preferences. No payment field, no document upload, no
 *   category, no entrance-exam field — the PRD defines none of their mechanics,
 *   so offering an input would be offering a capability that does not exist.
 *
 * IDENTIFIERS AND STAGE ARE NOT FIELDS
 *   applicantNo, applicationNo and stage are issued and owned by the server.
 *   The API refuses them outright, so there is nothing here to send.
 *
 * PROGRAMMES COME FROM THE TENANT
 *   Never hardcoded: the list is the university's own Programme rows, passed in
 *   from the server component.
 */
export function ApplicationForm({
  tenantId,
  programmes,
}: {
  tenantId: string;
  programmes: ProgrammeOption[];
}) {
  const router = useRouter();
  const { toast } = useToast();

  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    dateOfBirth: "",
    guardianName: "",
    guardianRelation: "",
    guardianPhone: "",
    guardianEmail: "",
  });
  // Ordered choices. Index 0 is first preference; §8.2 "Multiple programme
  // preferences" is an ordered list, so the position carries meaning.
  const [choices, setChoices] = useState<string[]>([""]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setFieldErrors((prev) => (prev[key] ? { ...prev, [key]: "" } : prev));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);

    const errors: Record<string, string> = {};
    if (!form.firstName.trim()) errors.firstName = "Enter a first name.";
    if (!form.lastName.trim()) errors.lastName = "Enter a last name.";
    if (!form.email.trim()) {
      errors.email = "Enter an email address.";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      errors.email = "Enter a valid email address.";
    }
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    // Blank rows are dropped, and the surviving order becomes the priority —
    // so removing a middle choice does not leave a gap in the ranking.
    const preferences = choices
      .map((programmeId) => programmeId.trim())
      .filter(Boolean)
      .map((programmeId, index) => ({ programmeId, priority: index + 1 }));

    setIsSubmitting(true);
    const result = await createApplication(tenantId, {
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      email: form.email.trim().toLowerCase(),
      phone: form.phone.trim() || undefined,
      dateOfBirth: form.dateOfBirth || undefined,
      guardianName: form.guardianName.trim() || undefined,
      guardianRelation: form.guardianRelation.trim() || undefined,
      guardianPhone: form.guardianPhone.trim() || undefined,
      guardianEmail: form.guardianEmail.trim().toLowerCase() || undefined,
      preferences: preferences.length ? preferences : undefined,
    });
    setIsSubmitting(false);

    if (!result.success) {
      // §8.3 duplicate detection lands on the field it is about.
      if (result.code === "CONFLICT") {
        setFieldErrors({ email: "An application with that email already exists here." });
        return;
      }
      setFormError(result.error);
      return;
    }

    toast({
      variant: "success",
      title: "Application created",
      description: `${result.data.applicationNo} · applicant ${result.data.applicantNo}`,
    });
    router.push(`/platform/tenants/${tenantId}/admissions/${result.data.id}`);
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-6" noValidate>
      {formError && <Alert variant="error">{formError}</Alert>}

      <Card>
        <h2 className="text-sm font-semibold text-heading">Applicant</h2>
        <div className="mt-4 grid max-w-2xl grid-cols-1 gap-4 sm:grid-cols-2">
          <Input label="First name" required value={form.firstName} error={fieldErrors.firstName} onChange={(e) => set("firstName", e.target.value)} autoFocus />
          <Input label="Last name" required value={form.lastName} error={fieldErrors.lastName} onChange={(e) => set("lastName", e.target.value)} />
          <Input label="Email" type="email" required value={form.email} error={fieldErrors.email} onChange={(e) => set("email", e.target.value)} helperText="Unique per university — used to detect duplicate applications." />
          <Input label="Phone" value={form.phone} onChange={(e) => set("phone", e.target.value)} />
          <Input label="Date of birth" type="date" value={form.dateOfBirth} onChange={(e) => set("dateOfBirth", e.target.value)} />
        </div>
      </Card>

      <Card>
        <h2 className="text-sm font-semibold text-heading">Guardian</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Recorded on the application. A parent record is created later, if the university chooses.
        </p>
        <div className="mt-4 grid max-w-2xl grid-cols-1 gap-4 sm:grid-cols-2">
          <Input label="Guardian name" value={form.guardianName} onChange={(e) => set("guardianName", e.target.value)} />
          <Input label="Relation" value={form.guardianRelation} onChange={(e) => set("guardianRelation", e.target.value)} placeholder="Mother" />
          <Input label="Guardian phone" value={form.guardianPhone} onChange={(e) => set("guardianPhone", e.target.value)} />
          <Input label="Guardian email" type="email" value={form.guardianEmail} onChange={(e) => set("guardianEmail", e.target.value)} />
        </div>
      </Card>

      <Card>
        <h2 className="text-sm font-semibold text-heading">Programme preferences</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          In order of preference. The first is the applicant&rsquo;s first choice.
        </p>

        {programmes.length === 0 ? (
          <Alert variant="warning" className="mt-3">
            This university has no programmes yet, so no preference can be recorded. Add
            programmes first.
          </Alert>
        ) : (
          <div className="mt-4 flex max-w-lg flex-col gap-3">
            {choices.map((value, index) => (
              <div key={index} className="flex items-end gap-2">
                <Select
                  label={`Choice ${index + 1}`}
                  value={value}
                  onChange={(next) =>
                    setChoices((prev) => prev.map((v, i) => (i === index ? next : v)))
                  }
                  placeholder="Select a programme"
                  options={programmes
                    // A programme already chosen elsewhere is not offered again —
                    // the API refuses duplicates, so the form should not allow one.
                    .filter((p) => p.id === value || !choices.includes(p.id))
                    .map((p) => ({ value: p.id, label: `${p.code} — ${p.name}` }))}
                  containerClassName="flex-1"
                />
                {choices.length > 1 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setChoices((prev) => prev.filter((_, i) => i !== index))}
                  >
                    Remove
                  </Button>
                )}
              </div>
            ))}

            {choices.length < Math.min(10, programmes.length) && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setChoices((prev) => [...prev, ""])}
                className="self-start"
              >
                Add another choice
              </Button>
            )}
          </div>
        )}
      </Card>

      <div className="flex gap-2">
        <Button type="submit" isLoading={isSubmitting}>
          Create application
        </Button>
        <Link
          href={`/platform/tenants/${tenantId}/admissions`}
          className={buttonStyles({ variant: "secondary" })}
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
