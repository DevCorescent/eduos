"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/providers/ToastProvider";
import { updateProfileAction } from "@/actions/account";

interface ProfileValues {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
}

type FieldErrors = Partial<Record<keyof ProfileValues, string>>;

export interface ProfileFormProps {
  initialValues: ProfileValues;
}

/**
 * Name, email and phone for the signed-in person.
 *
 * Takes no user id — the action resolves "me" from the session, so there is
 * nothing in the payload that could aim this edit at another account.
 */
export function ProfileForm({ initialValues }: ProfileFormProps) {
  const router = useRouter();
  const { toast } = useToast();

  const [values, setValues] = useState<ProfileValues>(initialValues);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function setValue<K extends keyof ProfileValues>(key: K, value: ProfileValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
    setFieldErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev));
  }

  // Compared against the props rather than tracked with a flag, so the button
  // re-disables by itself once a save makes the server's copy match again.
  const isDirty =
    values.firstName !== initialValues.firstName ||
    values.lastName !== initialValues.lastName ||
    values.email !== initialValues.email ||
    values.phone !== initialValues.phone;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    setIsSubmitting(true);

    const result = await updateProfileAction({
      firstName: values.firstName,
      lastName: values.lastName,
      email: values.email,
      phone: values.phone || null,
    });

    setIsSubmitting(false);

    if (!result.success) {
      if (result.field) {
        setFieldErrors({ [result.field]: result.error } as FieldErrors);
        return;
      }
      setFormError(result.error);
      return;
    }

    toast({ variant: "success", title: "Profile updated" });
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
      {formError && <Alert variant="error">{formError}</Alert>}

      {/* One column below sm, two above: side-by-side name fields are unreadable
          at 360px, where each would be about 150px wide. */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label="First name"
          required
          value={values.firstName}
          onChange={(e) => setValue("firstName", e.target.value)}
          error={fieldErrors.firstName}
          autoComplete="given-name"
        />
        <Input
          label="Last name"
          required
          value={values.lastName}
          onChange={(e) => setValue("lastName", e.target.value)}
          error={fieldErrors.lastName}
          autoComplete="family-name"
        />
      </div>

      <Input
        label="Email"
        type="email"
        required
        value={values.email}
        onChange={(e) => setValue("email", e.target.value)}
        error={fieldErrors.email}
        helperText="Used to sign in and to receive notifications."
        autoComplete="email"
      />

      <Input
        label="Phone"
        type="tel"
        value={values.phone}
        onChange={(e) => setValue("phone", e.target.value)}
        error={fieldErrors.phone}
        placeholder="+91 98765 43210"
        autoComplete="tel"
      />

      {/* Full-width button below sm so the tap target spans the screen; shrunk
          to its content and right-aligned once there is room. */}
      <div className="flex flex-col sm:flex-row sm:justify-end">
        <Button type="submit" isLoading={isSubmitting} disabled={!isDirty} fullWidth className="sm:w-auto">
          Save changes
        </Button>
      </div>
    </form>
  );
}
