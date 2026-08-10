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
import { createPlatformUser, type PlatformRoleName } from "@/services/platformUsers";
import { TemporaryPasswordDialog } from "../TemporaryPasswordDialog";

interface FormState {
  firstName: string;
  lastName: string;
  email: string;
  role: PlatformRoleName;
}

type FieldErrors = Partial<Record<keyof FormState, string>>;

const EMPTY_FORM: FormState = {
  firstName: "",
  lastName: "",
  email: "",
  role: "PLATFORM_ADMIN",
};

/**
 * The roles offered.
 *
 * ONE ENTRY, BECAUSE ONE ROLE EXISTS
 *   PlatformRole holds exactly one row, PLATFORM_ADMIN, and the API's Zod enum
 *   accepts exactly that name. Listing the ~13 roles the PRD names would offer
 *   choices that fail validation and, worse, imply an authorization model that
 *   has no permissions behind it. SUPER_ADMIN is absent for the same reason it
 *   is absent from the schema: it was the tenant-writable string that made the
 *   W1.1 escalation possible, and it is not a platform role.
 *
 *   The select is still rendered rather than hidden, so the account's role is
 *   a visible, deliberate choice at creation rather than an invisible default.
 */
const ROLE_OPTIONS: { value: PlatformRoleName; label: string }[] = [
  { value: "PLATFORM_ADMIN", label: "Platform Admin" },
];

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
 * Create a platform operator.
 *
 * A full page rather than the modal the tenant list uses, because the result is
 * not a row appearing in a table: it is a credential that must be read and
 * handed over before the screen is left. A modal that closes into a refreshed
 * list is the wrong shape for that.
 *
 * NO PASSWORD FIELD
 *   The API generates one and returns it once. An operator does not choose a
 *   colleague's password — that would leave a credential somebody else knows
 *   and can keep using, with nothing on the account to show for it.
 *
 * The success path deliberately does NOT navigate away. It shows the generated
 * password and waits: navigating first would replace the only copy of a value
 * that cannot be retrieved again.
 */
export function NewPlatformUserForm() {
  const router = useRouter();
  const { toast } = useToast();

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [created, setCreated] = useState<{ email: string; password: string } | null>(null);

  function updateField<K extends keyof FormState>(field: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [field]: value }));
    setFieldErrors((prev) => (prev[field] ? { ...prev, [field]: undefined } : prev));
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

    const result = await createPlatformUser({
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      // Lowercased to match what the API stores and what the login route looks
      // up, so "Admin@x.com" and "admin@x.com" cannot become two identities.
      email: form.email.trim().toLowerCase(),
      role: form.role,
    });

    setIsSubmitting(false);

    if (!result.success) {
      // The one deliberate exception to "no component inspects an error code",
      // matching OnboardTenantButton: a duplicate address is a field-level
      // problem, and resolveUiState would collapse it into a page-level error
      // that loses which field the clash is about.
      if (result.code === "CONFLICT") {
        setFieldErrors({ email: "An operator with that email already exists." });
        return;
      }
      setFormError(result.error);
      return;
    }

    toast({ variant: "success", title: "Operator created" });
    setCreated({ email: result.data.user.email, password: result.data.temporaryPassword });
  }

  return (
    <>
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
              autoFocus
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
            helperText="Used to sign in at /super-admin/login."
          />

          <Select
            label="Role"
            value={form.role}
            onChange={(value) => updateField("role", value as PlatformRoleName)}
            options={ROLE_OPTIONS}
            helperText="Platform Admin is the only platform role defined today."
          />

          <Alert variant="info">
            A temporary password is generated and shown to you once after the account is created.
            They must replace it before they can use the console.
          </Alert>

          <div className="flex gap-2">
            <Button type="submit" isLoading={isSubmitting}>
              Create operator
            </Button>
            <Link href="/platform/users" className={buttonStyles({ variant: "secondary" })}>
              Cancel
            </Link>
          </div>
        </form>
      </Card>

      {created && (
        <TemporaryPasswordDialog
          isOpen
          email={created.email}
          password={created.password}
          // Only now is it safe to leave: the password has been dismissed
          // deliberately rather than navigated away from.
          onClose={() => {
            setCreated(null);
            router.push("/platform/users");
            router.refresh();
          }}
        />
      )}
    </>
  );
}
