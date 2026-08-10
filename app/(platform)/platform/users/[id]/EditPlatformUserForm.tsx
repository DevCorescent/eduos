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
import {
  updatePlatformUser,
  type PlatformRoleName,
  type UpdatePlatformUserInput,
} from "@/services/platformUsers";
import type { PlatformUser } from "@/types";

export interface EditPlatformUserFormProps {
  user: PlatformUser;
  /** The signed-in operator's id, so the active switch is locked on their own row. */
  currentUserId: string;
}

interface FormState {
  firstName: string;
  lastName: string;
  email: string;
  role: PlatformRoleName;
  isActive: boolean;
}

type FieldErrors = Partial<Record<keyof FormState, string>>;

/** See NewPlatformUserForm — one role exists, so one option is offered. */
const ROLE_OPTIONS: { value: PlatformRoleName; label: string }[] = [
  { value: "PLATFORM_ADMIN", label: "Platform Admin" },
];

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function toFormState(user: PlatformUser): FormState {
  return {
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    // An account holding no grant, or one this build does not know, falls back
    // to the only role that exists — saving then repairs it rather than
    // silently writing back a value the select could not represent.
    role: (ROLE_OPTIONS.find((o) => user.roles.includes(o.value))?.value ??
      "PLATFORM_ADMIN") as PlatformRoleName,
    isActive: user.isActive,
  };
}

function validate(form: FormState): FieldErrors {
  const errors: FieldErrors = {};

  if (!form.firstName.trim()) errors.firstName = "Enter a first name.";
  if (!form.lastName.trim()) errors.lastName = "Enter a last name.";

  if (!form.email.trim()) {
    errors.email = "Enter an email address.";
  } else if (!EMAIL_PATTERN.test(form.email.trim())) {
    errors.email = "Enter a valid email address.";
  }

  return errors;
}

/**
 * Edit one platform operator.
 *
 * ONLY CHANGED FIELDS ARE SENT
 *   The API's PATCH schema is partial and its uniqueness check skips an email
 *   that is not actually changing. Posting the whole form every time would work
 *   but would make every save look like an email change in the diff below, and
 *   would advance updatedAt on a form somebody merely opened and submitted.
 *
 * WHAT THIS FORM CANNOT TOUCH, BY CONSTRUCTION
 *   id, createdAt, updatedAt, lastLoginAt and passwordHash are not fields here
 *   and are not in the API's schema either — the frontend not offering them is
 *   the presentation of that rule, not the enforcement of it. There is no
 *   tenantId on a platform identity to protect: that absence is the whole
 *   security property of the model.
 */
export function EditPlatformUserForm({ user, currentUserId }: EditPlatformUserFormProps) {
  const router = useRouter();
  const { toast } = useToast();

  const [form, setForm] = useState<FormState>(() => toFormState(user));
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isSelf = user.id === currentUserId;

  function updateField<K extends keyof FormState>(field: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [field]: value }));
    setFieldErrors((prev) => (prev[field] ? { ...prev, [field]: undefined } : prev));
  }

  /** The subset of fields whose value differs from the loaded record. */
  function changedFields(): UpdatePlatformUserInput {
    const changes: UpdatePlatformUserInput = {};
    const firstName = form.firstName.trim();
    const lastName = form.lastName.trim();
    const email = form.email.trim().toLowerCase();

    if (firstName !== user.firstName) changes.firstName = firstName;
    if (lastName !== user.lastName) changes.lastName = lastName;
    if (email !== user.email) changes.email = email;
    if (!user.roles.includes(form.role)) changes.role = form.role;
    if (form.isActive !== user.isActive) changes.isActive = form.isActive;

    return changes;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);

    const errors = validate(form);
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    const changes = changedFields();

    // The API rejects an empty body — every field optional, at least one
    // required — so saying nothing changed is more useful than a 400.
    if (Object.keys(changes).length === 0) {
      setFormError("Nothing has changed.");
      return;
    }

    setIsSubmitting(true);
    const result = await updatePlatformUser(user.id, changes);
    setIsSubmitting(false);

    if (!result.success) {
      // Field-level for a duplicate address, matching the create form; a
      // page-level banner would lose which field the clash is about.
      if (result.code === "CONFLICT") {
        setFieldErrors({ email: "An operator with that email already exists." });
        return;
      }
      setFormError(result.error);
      return;
    }

    toast({ variant: "success", title: "Operator updated" });
    // Re-runs the server page, so the form re-initialises from the saved record
    // rather than from stale client state that merely looks saved.
    router.refresh();
  }

  return (
    <Card>
      {formError && (
        <Alert variant="error" className="mb-4">
          {formError}
        </Alert>
      )}

      <form onSubmit={handleSubmit} className="flex max-w-lg flex-col gap-4" noValidate>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="First name"
            required
            value={form.firstName}
            onChange={(e) => updateField("firstName", e.target.value)}
            error={fieldErrors.firstName}
          />
          <Input
            label="Last name"
            required
            value={form.lastName}
            onChange={(e) => updateField("lastName", e.target.value)}
            error={fieldErrors.lastName}
          />
        </div>

        <Input
          label="Email"
          type="email"
          required
          value={form.email}
          onChange={(e) => updateField("email", e.target.value)}
          error={fieldErrors.email}
          helperText="Changing this changes the address they sign in with."
        />

        <Select
          label="Role"
          value={form.role}
          onChange={(value) => updateField("role", value as PlatformRoleName)}
          options={ROLE_OPTIONS}
          helperText="Platform Admin is the only platform role defined today."
        />

        <Switch
          label="Active"
          checked={form.isActive}
          onChange={(e) => updateField("isActive", e.target.checked)}
          // The API answers 409 for self-deactivation; the control is locked so
          // the refusal is never the way somebody finds out. Deactivating
          // yourself would take the console away mid-request and, if you were
          // the last active operator, leave nobody able to undo it.
          disabled={isSelf && user.isActive}
          helperText={
            isSelf && user.isActive
              ? "You cannot deactivate your own account."
              : "An inactive operator keeps their account and role but cannot sign in."
          }
        />

        <div className="flex gap-2">
          <Button type="submit" isLoading={isSubmitting}>
            Save changes
          </Button>
          <Link href="/platform/users" className={buttonStyles({ variant: "secondary" })}>
            Back to list
          </Link>
        </div>
      </form>
    </Card>
  );
}
